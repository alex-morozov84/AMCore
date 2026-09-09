import { Writable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { createServerLogger } from './logger'

vi.mock('server-only', () => ({}))

/**
 * A synchronous in-memory sink: `_write`'s callback runs before `write()`
 * returns, so `lines()` immediately after `logger.warn()`/`.error()` sees
 * every chunk - unlike a `PassThrough`'s `'data'` event, which Node may
 * defer to a later tick even for an already-buffered write.
 */
function createSyncSink(): { stream: Writable; lines: () => unknown[] } {
  let buffer = ''
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += (chunk as Buffer).toString('utf8')
      callback()
    },
  })
  return {
    stream,
    lines: () =>
      buffer
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown),
  }
}

describe('createServerLogger real serialization', () => {
  it('emits real JSON with the fields passed to it', () => {
    const { stream, lines } = createSyncSink()
    const logger = createServerLogger(stream)

    logger.warn({ event: 'secondary_data_degraded', source: 'queue-panel' }, 'degraded_data')

    const [record] = lines() as Array<Record<string, unknown>>
    expect(record.event).toBe('secondary_data_degraded')
    expect(record.source).toBe('queue-panel')
    expect(record.msg).toBe('degraded_data')
    expect(record.level).toBeTypeOf('number')
  })

  it('redacts a sensitive field name even though the bounded loggers never pass one - defense in depth', () => {
    const { stream, lines } = createSyncSink()
    const logger = createServerLogger(stream)

    logger.warn({ event: 'x', token: 'super-secret-value' }, 'msg')

    const [record] = lines() as Array<Record<string, unknown>>
    expect(record.token).toBe('[REDACTED]')
    expect(JSON.stringify(record)).not.toContain('super-secret-value')
  })

  it('redacts a nested sensitive field via the wildcard path', () => {
    const { stream, lines } = createSyncSink()
    const logger = createServerLogger(stream)

    logger.warn({ event: 'x', context: { password: 'hunter2' } }, 'msg')

    const [record] = lines() as Array<Record<string, unknown>>
    expect((record.context as Record<string, unknown>).password).toBe('[REDACTED]')
  })
})
