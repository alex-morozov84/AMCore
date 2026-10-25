import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'

import { Redis } from 'ioredis'

import { LoginLimitConnection } from './login-limit-connection'

jest.mock('ioredis', () => ({ Redis: jest.fn() }))

class FakeClient extends EventEmitter {
  status = 'wait'
  stream = Object.assign(new EventEmitter(), { closed: false })
  connect = jest.fn(async () => {
    this.status = 'ready'
  })
  eval = jest.fn(async () => [1, 0])
  disconnect = jest.fn(() => {
    this.finish()
  })
  finish(): void {
    this.status = 'end'
    this.stream.closed = true
    this.stream.emit('close')
    this.emit('end')
  }
}
const execute = (operation: LoginLimitConnection) =>
  operation.run(() => 'redis://fixture', 'fixed', ['a', 'b', 'c'], 'check')

describe('login limiter monotonic lifecycle model (not Redis proof)', () => {
  let clients: FakeClient[]
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(performance, 'now').mockImplementation(() => jest.now())
    clients = []
    jest.mocked(Redis).mockImplementation(() => {
      const c = new FakeClient()
      clients.push(c)
      return c as never
    })
  })
  afterEach(() => {
    for (const c of clients) c.finish()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })
  it('bounds stalled readiness, prevents late EVAL and releases only after settled cancellation', async () => {
    let ready!: () => void
    jest.mocked(Redis).mockImplementation(() => {
      const c = new FakeClient()
      clients.push(c)
      c.connect.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            ready = resolve
          })
      )
      return c as never
    })
    const result = execute(LoginLimitConnection.acquire()).catch((error) => error)
    await jest.advanceTimersByTimeAsync(450)
    expect(clients[0]!.eval).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(50)
    expect(await result).toBeInstanceOf(Error)
    ready()
    await jest.advanceTimersByTimeAsync(0)
    expect(clients[0]!.eval).not.toHaveBeenCalled()
  })
  it('counts32 closing leases until actual close and restores capacity exactly once', async () => {
    jest.mocked(Redis).mockImplementation(() => {
      const c = new FakeClient()
      clients.push(c)
      c.disconnect.mockImplementation(() => undefined)
      return c as never
    })
    const results = Array.from({ length: 32 }, () =>
      execute(LoginLimitConnection.acquire()).catch((error) => error)
    )
    await jest.advanceTimersByTimeAsync(50)
    expect((await Promise.all(results)).every((item) => item instanceof Error)).toBe(true)
    expect(() => LoginLimitConnection.acquire()).toThrow('capacity')
    expect(clients).toHaveLength(32)
    clients[0]!.finish()
    clients[0]!.finish()
    const operation = LoginLimitConnection.acquire()
    expect(() => LoginLimitConnection.acquire()).toThrow('capacity')
    await operation.stop()
  })
  it('cancels before deferred client creation and rejects ready exactly at the work deadline', async () => {
    const early = LoginLimitConnection.acquire()
    const cancelled = execute(early).catch((error) => error)
    await early.stop()
    expect(await cancelled).toBeInstanceOf(Error)
    expect(clients).toHaveLength(0)
    let ready!: () => void
    jest.mocked(Redis).mockImplementation(() => {
      const c = new FakeClient()
      clients.push(c)
      c.connect.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            ready = resolve
          })
      )
      return c as never
    })
    const result = execute(LoginLimitConnection.acquire()).catch((error) => error)
    await Promise.resolve()
    jest.setSystemTime(jest.now() + 450)
    ready()
    await jest.advanceTimersByTimeAsync(0)
    expect(await result).toBeInstanceOf(Error)
    expect(clients[0]!.eval).not.toHaveBeenCalled()
  })
  it('releases capacity after constructor or listener setup failure', async () => {
    jest.mocked(Redis).mockImplementationOnce(() => {
      throw new Error('constructor')
    })
    await expect(execute(LoginLimitConnection.acquire())).rejects.toThrow('constructor')
    jest.mocked(Redis).mockImplementationOnce(() => {
      const c = new FakeClient()
      clients.push(c)
      const original = c.on.bind(c)
      c.on = ((event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'connect') throw new Error('listener')
        return original(event, listener)
      }) as typeof c.on
      return c as never
    })
    await expect(execute(LoginLimitConnection.acquire())).rejects.toThrow('listener')
    await expect(execute(LoginLimitConnection.acquire())).resolves.toEqual([1, 0])
  })
  it('protects constructor/options failure and allows healthy cleanup', async () => {
    const bad = LoginLimitConnection.acquire()
    await expect(
      bad.run(
        () => {
          throw new Error('options')
        },
        'fixed',
        [],
        'check'
      )
    ).rejects.toThrow('options')
    await expect(execute(LoginLimitConnection.acquire())).resolves.toEqual([1, 0])
    expect(clients[0]!.disconnect).toHaveBeenCalledTimes(1)
  })
  it('does not replay a dispatched command after timeout or accept its late result', async () => {
    let reply!: (value: number[]) => void
    const operation = LoginLimitConnection.acquire()
    const result = execute(operation).catch((error) => error)
    await Promise.resolve()
    clients[0]!.eval.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve
        })
    )
    await jest.advanceTimersByTimeAsync(450)
    expect(await result).toBeInstanceOf(Error)
    reply([1, 0])
    await jest.advanceTimersByTimeAsync(0)
    expect(clients[0]!.eval).toHaveBeenCalledTimes(1)
  })
})
