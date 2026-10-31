import { EventEmitter } from 'node:events'

import { DisconnectsClientError } from '@redis/client'

import type { WebRedisClient } from '../redis-client'

/**
 * Test double of the node-redis surface the vault supervisor and bounded runner use. A held command
 * models a WRITTEN command whose reply never arrives: it ignores the abort signal and only
 * `destroy()` settles it (with `DisconnectsClientError`), as the real client does.
 */
export class FakeVaultClient extends EventEmitter {
  isOpen = false
  isReady = false
  hold = false
  pingReply = 'PONG'
  destroyWorks = true
  autoReady = true
  destroyed = false
  private readonly pending = new Set<{ reject: (error: Error) => void }>()

  connect(): Promise<void> {
    this.isOpen = true
    if (this.autoReady) queueMicrotask(() => this.becomeReady())
    return Promise.resolve()
  }

  becomeReady(): void {
    this.isReady = true
    this.emit('ready')
  }

  loseReadiness(emitEvent = true): void {
    this.isReady = false
    if (emitEvent) this.emit('reconnecting')
  }

  endByItself(): void {
    this.isOpen = false
    this.isReady = false
    this.emit('end')
  }

  withCommandOptions(): this {
    return this
  }

  ping(): Promise<string> {
    return this.command(this.pingReply)
  }

  get pendingCount(): number {
    return this.pending.size
  }

  destroy(): void {
    this.destroyed = true
    if (!this.destroyWorks) return
    this.isOpen = false
    this.isReady = false
    for (const entry of this.pending) entry.reject(new DisconnectsClientError())
    this.pending.clear()
    this.emit('end')
  }

  asClient(): WebRedisClient {
    return this as unknown as WebRedisClient
  }

  private command(reply: string): Promise<string> {
    if (!this.hold) return Promise.resolve(reply)
    return new Promise<string>((_resolve, reject) => {
      this.pending.add({ reject })
    })
  }
}
