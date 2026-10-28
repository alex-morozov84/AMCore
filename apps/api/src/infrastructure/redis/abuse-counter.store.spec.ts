import { ABUSE_COUNTER_INCREMENT_SCRIPT, ABUSE_COUNTER_READ_SCRIPT } from './abuse-counter.lua'
import { AbuseCounterError, AbuseCounterStore } from './abuse-counter.store'
import type { BoundedRedis, BoundedRedisClient } from './bounded-redis'
import { BoundedRedisError } from './bounded-redis'

// Reply decoding and error mapping only. The Lua itself, atomicity and the refusal
// cases run against a real Redis in abuse-counter.redis.e2e-spec.ts.

describe('AbuseCounterStore', () => {
  let client: { eval: jest.Mock; del: jest.Mock }
  let run: jest.Mock
  let store: AbuseCounterStore

  beforeEach(() => {
    client = { eval: jest.fn(), del: jest.fn() }
    run = jest.fn((operation: (c: BoundedRedisClient, s: AbortSignal) => Promise<unknown>) =>
      operation(client as unknown as BoundedRedisClient, new AbortController().signal)
    )
    store = new AbuseCounterStore({ run } as unknown as BoundedRedis)
  })

  const failure = async (promise: Promise<unknown>): Promise<AbuseCounterError> => {
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AbuseCounterError)
    return error as AbuseCounterError
  }

  describe('read()', () => {
    it('evaluates the read script over both keys and decodes the counts', async () => {
      client.eval.mockResolvedValue([3, 7])

      await expect(store.read('ip-key', 'subject-key')).resolves.toEqual({ ip: 3, subject: 7 })

      expect(client.eval).toHaveBeenCalledWith(ABUSE_COUNTER_READ_SCRIPT, {
        keys: ['ip-key', 'subject-key'],
        arguments: [],
      })
    })
  })

  describe('increment()', () => {
    it('passes the expiry as the only argument and decodes the new counts', async () => {
      client.eval.mockResolvedValue([4, 8])

      await expect(store.increment('ip-key', 'subject-key', 3_600_000)).resolves.toEqual({
        ip: 4,
        subject: 8,
      })

      expect(client.eval).toHaveBeenCalledWith(ABUSE_COUNTER_INCREMENT_SCRIPT, {
        keys: ['ip-key', 'subject-key'],
        arguments: ['3600000'],
      })
    })

    it.each([0, -1, 1.5, Number.NaN, 86_400_001, Number.MAX_SAFE_INTEGER + 1])(
      'rejects the expiry %p before sending anything',
      (ttl) => {
        expect(() => store.increment('a', 'b', ttl)).toThrow(RangeError)
        expect(run).not.toHaveBeenCalled()
      }
    )
  })

  describe('script refusal and unexpected replies', () => {
    it('maps the refusal status to invalid_state, nothing recorded', async () => {
      client.eval.mockResolvedValue([-1, -1])

      const error = await failure(store.increment('a', 'b', 1000))

      expect(error).toMatchObject({ kind: 'invalid_state', outcome: 'not_sent' })
    })

    it.each([
      ['a string', 'OK'],
      ['null', null],
      ['one element', [1]],
      ['three elements', [1, 2, 3]],
      ['a non-integer', [1, 1.5]],
      ['a string element', [1, '2']],
      ['a negative count', [1, -2]],
    ])('treats %s as an invalid reply with an unknown outcome', async (_label, reply) => {
      client.eval.mockResolvedValue(reply)

      const error = await failure(store.read('a', 'b'))

      expect(error).toMatchObject({ kind: 'invalid_reply', outcome: 'unknown' })
    })
  })

  describe('bounded failures', () => {
    it('keeps not_sent when the helper proves nothing was sent', async () => {
      run.mockRejectedValue(new BoundedRedisError('capacity', 'not_sent'))

      expect(await failure(store.read('a', 'b'))).toMatchObject({
        kind: 'unavailable',
        outcome: 'not_sent',
      })
    })

    it('keeps unknown after a deadline', async () => {
      run.mockRejectedValue(new BoundedRedisError('deadline', 'unknown'))

      expect(await failure(store.increment('a', 'b', 1000))).toMatchObject({
        kind: 'unavailable',
        outcome: 'unknown',
      })
    })

    it('does not swallow programming errors', async () => {
      run.mockRejectedValue(new TypeError('boom'))

      await expect(store.read('a', 'b')).rejects.toBeInstanceOf(TypeError)
    })
  })

  describe('clear()', () => {
    it('deletes exactly the subject key', async () => {
      client.del.mockResolvedValue(1)

      await store.clear('subject-key')

      expect(client.del).toHaveBeenCalledTimes(1)
      expect(client.del).toHaveBeenCalledWith('subject-key')
    })

    it('maps a bounded failure to an unavailable error', async () => {
      run.mockRejectedValue(new BoundedRedisError('deadline', 'unknown'))

      expect(await failure(store.clear('subject-key'))).toMatchObject({
        kind: 'unavailable',
        outcome: 'unknown',
      })
    })
  })
})
