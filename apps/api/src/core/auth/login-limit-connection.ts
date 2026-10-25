import { performance } from 'node:perf_hooks'

import { Redis } from 'ioredis'

import { buildBullConnection } from '../../infrastructure/queue/redis-connection.config.js'

const leases = new Set<LoginLimitConnection>()
const WORK_MS = 450
const TOTAL_MS = 500
const CLEANUP_MS = 50

/** Absolute deadlines; late promise settlement is observed but cannot resume sending. */
function until<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Login limit deadline')),
      Math.max(0, deadline - performance.now())
    )
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** One owned standalone client. Closing/unconfirmed clients retain their process-wide lease. */
export class LoginLimitConnection {
  private readonly entry = performance.now()
  private stopPromise?: Promise<void>
  private stopped = false
  private client?: Redis
  private connecting = false
  private closed = false
  private notifyClose?: () => void
  private readonly errorSink = (): void => undefined
  private readonly observe = (): void => {
    this.observeClosure()
  }
  private observedStream?: Redis['stream']

  static acquire(): LoginLimitConnection {
    if (leases.size >= 32) throw new Error('Login limit capacity')
    const operation = new LoginLimitConnection()
    leases.add(operation)
    return operation
  }

  async run(
    redisUrl: () => string,
    script: string,
    keys: string[],
    mode: string
  ): Promise<unknown> {
    try {
      return await until(
        Promise.resolve().then(() => this.work(redisUrl, script, keys, mode)),
        this.entry + WORK_MS
      )
    } finally {
      await this.stop()
    }
  }

  private guard(): void {
    if (this.stopped || performance.now() >= this.entry + WORK_MS)
      throw new Error('Login limit stopped')
  }

  private async work(
    redisUrl: () => string,
    script: string,
    keys: string[],
    mode: string
  ): Promise<unknown> {
    this.guard()
    this.client = new Redis({
      ...buildBullConnection(redisUrl()),
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      autoResubscribe: false,
      enableAutoPipelining: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      reconnectOnError: () => false,
      connectTimeout: 250,
      commandTimeout: 250,
      disconnectTimeout: 0,
      enableReadyCheck: false,
      disableClientInfo: true,
    })
    this.client.on('error', this.errorSink)
    this.client.on('connect', this.observe)
    this.client.on('end', this.observe)
    this.guard()
    this.connecting = true
    try {
      await this.client.connect()
    } finally {
      this.connecting = false
      this.observeClosure()
    }
    this.guard()
    // No await between the last guard and dispatch. Date.now is only the data clock.
    const result = await this.client.eval(script, keys.length, ...keys, mode, String(Date.now()))
    this.guard()
    return result
  }

  private observeClosure(): void {
    const stream = this.client?.stream
    if (stream && stream !== this.observedStream) {
      this.observedStream = stream
      stream.once('close', this.observe)
    }
    if (!this.stopped || this.connecting) return
    if (this.client && (this.client.status !== 'end' || (stream && !stream.closed))) return
    this.closed = true
    leases.delete(this)
    this.client?.off('connect', this.observe)
    this.client?.off('end', this.observe)
    this.client?.off('error', this.errorSink)
    this.observedStream?.off('close', this.observe)
    this.notifyClose?.()
    this.notifyClose = undefined
  }

  stop(): Promise<void> {
    return (this.stopPromise ??= this.cleanup())
  }

  private async cleanup(): Promise<void> {
    this.stopped = true
    const deadline = Math.min(performance.now() + CLEANUP_MS, this.entry + TOTAL_MS)
    const closure = new Promise<void>((resolve) => {
      this.notifyClose = resolve
    })
    try {
      this.client?.disconnect(false)
    } finally {
      this.observeClosure()
    }
    if (this.closed) return
    // On timeout the close observer retains the lease until actual closure.
    try {
      await until(closure, deadline)
    } catch {
      this.notifyClose = undefined
      throw new Error('Login limit cleanup unavailable')
    }
  }
}
