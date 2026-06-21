import {
  TELEGRAM_SECRET_HEADER,
  TelegramSecretTokenVerifier,
} from './telegram-secret-token.webhook-verifier'
import type { WebhookVerificationInput } from './webhook.types'

const SECRET = 'aB0_-Zz9'

function inputWith(headers: WebhookVerificationInput['headers']): WebhookVerificationInput {
  return {
    headers,
    rawBody: Buffer.from('{"update_id":1}'),
    secret: SECRET,
    now: Date.now(),
    toleranceSeconds: 300,
  }
}

describe('TelegramSecretTokenVerifier', () => {
  const verifier = new TelegramSecretTokenVerifier()

  it('accepts a header equal to the configured secret', () => {
    const result = verifier.verify(inputWith({ [TELEGRAM_SECRET_HEADER]: SECRET }))
    expect(result).toEqual({ ok: true })
  })

  it('rejects a mismatched secret', () => {
    const result = verifier.verify(inputWith({ [TELEGRAM_SECRET_HEADER]: 'wrong-secret' }))
    expect(result).toEqual({ ok: false, reason: 'WEBHOOK_SIGNATURE_INVALID' })
  })

  it('rejects a missing header (uniform 401, not a distinct signal)', () => {
    expect(verifier.verify(inputWith({})).ok).toBe(false)
  })

  it('rejects an array-valued header', () => {
    const result = verifier.verify(inputWith({ [TELEGRAM_SECRET_HEADER]: [SECRET, SECRET] }))
    expect(result).toEqual({ ok: false, reason: 'WEBHOOK_SIGNATURE_INVALID' })
  })

  it('rejects an empty-string header against a non-empty secret', () => {
    expect(verifier.verify(inputWith({ [TELEGRAM_SECRET_HEADER]: '' })).ok).toBe(false)
  })

  it('does not throw on a length-mismatched candidate (constant-time over digests)', () => {
    expect(() => verifier.verify(inputWith({ [TELEGRAM_SECRET_HEADER]: 'x' }))).not.toThrow()
  })

  it('ignores the body and timestamp entirely (no signature/replay coupling)', () => {
    const result = verifier.verify({
      headers: { [TELEGRAM_SECRET_HEADER]: SECRET },
      rawBody: Buffer.from('arbitrary'),
      secret: SECRET,
      now: 0,
      toleranceSeconds: 0,
    })
    expect(result).toEqual({ ok: true })
  })
})
