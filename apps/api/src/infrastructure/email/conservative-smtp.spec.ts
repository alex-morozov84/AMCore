import { performance } from 'node:perf_hooks'

import type { QueuedEmailProvider } from './queued-email-provider'
import { sendFrozenQueuedEmail } from './queued-email-transport'

/** Injected protocol fixture only; no SMTP server, production provider or remote key. */
function smtpFixture(reply: '250' | '451' | '550' | 'lost' | 'pre-submit') {
  let submissions = 0
  const provider: QueuedEmailProvider = {
    provider: 'mock',
    recipeVersion: 2,
    transportTimeoutMs: 600000,
    scope: () => 'a'.repeat(64),
    send: async (body, _internalKey, _signal, admit) => {
      const { recipients } = JSON.parse(body) as { recipients: string[] }
      if (recipients.length !== 1) throw new Error('RECIPIENTS_UNSUPPORTED')
      if (reply === 'pre-submit')
        return { certainty: 'none', retryable: true, code: 'TRANSIENT_FAILURE' }
      admit()
      submissions += 1
      if (reply === 'lost') throw new Error('FINAL_REPLY_LOST')
      if (reply === '250') return { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
      return {
        certainty: 'none',
        retryable: reply === '451',
        code: reply === '451' ? 'TRANSIENT_FAILURE' : 'PERMANENT_FAILURE',
      }
    },
  }
  return { provider, count: () => submissions }
}

function fence() {
  const wall = Date.now()
  const monotonic = performance.now()
  return {
    redisTime: wall,
    pgTime: wall,
    nominalDeadline: 0,
    floorUpper: 0,
    beforeEval: { wall, monotonic },
    beforePg: { wall, monotonic },
  }
}

describe('Non-deduplicating queued transport boundary', () => {
  it.each([
    ['250', 'accepted'],
    ['451', 'none'],
    ['550', 'none'],
    ['lost', 'unknown'],
    ['pre-submit', 'none'],
  ] as const)(
    'classifies final reply %s without a remote key or retention window',
    async (reply, certainty) => {
      const fixture = smtpFixture(reply)
      const result = await sendFrozenQueuedEmail(
        fixture.provider,
        JSON.stringify({ recipients: ['fake@example.invalid'] }),
        'internal-intent',
        fixture.provider.scope(),
        fence(),
        async () => fence()
      )
      expect(result).toMatchObject({ status: 'outcome', outcome: { certainty } })
      expect(fixture.count()).toBe(reply === 'pre-submit' ? 0 : 1) // No hidden second submission after a lost final reply.
    }
  )
  it('refuses multi-recipient payload before transport, not aggregate none after partial acceptance', async () => {
    const fixture = smtpFixture('250')
    const result = await sendFrozenQueuedEmail(
      fixture.provider,
      JSON.stringify({ recipients: ['a@example.invalid', 'b@example.invalid'] }),
      'internal-intent',
      fixture.provider.scope(),
      fence(),
      async () => fence()
    )
    expect(result.status).toBe('not-called')
    expect(fixture.count()).toBe(0)
  })
  it('cannot silently inherit the HTTP timeout for another adapter', async () => {
    const fixture = smtpFixture('250')
    const result = await sendFrozenQueuedEmail(
      { ...fixture.provider, transportTimeoutMs: undefined },
      '{}',
      'internal',
      fixture.provider.scope(),
      fence(),
      async () => fence()
    )
    expect(result).toEqual({ status: 'not-called', reason: 'WORK_UNAVAILABLE' })
    expect(fixture.count()).toBe(0)
  })
})
