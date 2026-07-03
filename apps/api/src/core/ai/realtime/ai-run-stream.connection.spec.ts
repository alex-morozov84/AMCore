import type { AiRunSseEvent } from '@amcore/shared'

import {
  AiRunStreamConnection,
  type StreamCloseReason,
  type StreamWritable,
} from './ai-run-stream.connection'

function fakeRes() {
  const writes: string[] = []
  let drainListener: (() => void) | undefined
  const state = { writable: true }
  const res = {
    write: jest.fn((chunk: string) => {
      writes.push(chunk)
      return state.writable
    }),
    end: jest.fn(),
    destroy: jest.fn(),
    once: jest.fn((_event: string, listener: () => void) => {
      drainListener = listener
    }),
    removeListener: jest.fn(),
  }
  return {
    res: res as unknown as StreamWritable,
    raw: res,
    writes,
    setWritable: (value: boolean) => (state.writable = value),
    drain: () => drainListener?.(),
  }
}

const SSE: AiRunSseEvent = {
  eventId: 'evt-1',
  runId: 'run-1',
  status: 'running',
  reason: 'status_changed',
}

const tracked: AiRunStreamConnection[] = []
function connect(res: StreamWritable, onClose: (r: StreamCloseReason) => void, queueDepth = 16) {
  const conn = new AiRunStreamConnection(res, 'user-1', 'run-1', {
    queueDepth,
    lifetimeMs: 60000,
    onClose,
  })
  tracked.push(conn)
  return conn
}

describe('AiRunStreamConnection', () => {
  afterEach(() => {
    for (const conn of tracked) conn.close('shutdown')
    tracked.length = 0
  })

  it('writes the ready comment on open and a data frame on sendData', () => {
    const f = fakeRes()
    const conn = connect(f.res, jest.fn())

    conn.open()
    conn.sendData(SSE)

    expect(f.writes[0]).toBe(': ready\n\n')
    expect(f.writes[1]).toBe(`data: ${JSON.stringify(SSE)}\n\n`)
  })

  it('buffers while backpressured and flushes the queue on drain', () => {
    const f = fakeRes()
    const conn = connect(f.res, jest.fn())
    conn.open()

    f.setWritable(false)
    conn.sendData(SSE) // first write returns false → backpressured
    const writesWhileBlocked = f.writes.length
    conn.sendData(SSE) // queued, not written
    expect(f.writes.length).toBe(writesWhileBlocked)

    f.setWritable(true)
    f.drain()
    expect(f.writes.length).toBe(writesWhileBlocked + 1) // queued frame flushed
  })

  it('destroys the socket and reports overflow once the queue is full', () => {
    const f = fakeRes()
    const onClose = jest.fn()
    const conn = connect(f.res, onClose, 1)
    conn.open()

    f.setWritable(false)
    conn.sendData(SSE) // backpressured (this write) — nothing queued yet
    conn.sendData(SSE) // queued (depth 1)
    conn.sendData(SSE) // overflow

    expect(f.raw.destroy).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('overflow')
    expect(f.raw.removeListener).toHaveBeenCalledWith('drain', expect.any(Function))
  })

  it('skips heartbeats while backpressured and writes them otherwise', () => {
    const f = fakeRes()
    const conn = connect(f.res, jest.fn())
    conn.open()

    conn.heartbeat()
    expect(f.writes).toContain(': hb\n\n')

    f.setWritable(false)
    conn.sendData(SSE) // trip backpressure
    const before = f.writes.length
    conn.heartbeat() // skipped
    expect(f.writes.length).toBe(before)
  })

  it('closes on the lifetime timer with reason expired', () => {
    jest.useFakeTimers()
    try {
      const f = fakeRes()
      const onClose = jest.fn()
      const conn = new AiRunStreamConnection(f.res, 'user-1', 'run-1', {
        queueDepth: 16,
        lifetimeMs: 1000,
        onClose,
      })
      conn.open()

      jest.advanceTimersByTime(1000)

      expect(onClose).toHaveBeenCalledWith('expired')
      expect(f.raw.end).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('is idempotent: a second close does not re-fire onClose, and writes stop', () => {
    const f = fakeRes()
    const onClose = jest.fn()
    const conn = connect(f.res, onClose)
    conn.open()

    conn.close('client')
    conn.close('client')
    conn.sendData(SSE)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(f.raw.end).toHaveBeenCalledTimes(1)
    expect(f.writes).not.toContain(`data: ${JSON.stringify(SSE)}\n\n`)
  })
})
