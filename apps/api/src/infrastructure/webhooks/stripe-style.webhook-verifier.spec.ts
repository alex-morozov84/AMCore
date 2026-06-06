import { StripeStyleWebhookVerifier } from './stripe-style.webhook-verifier'
import { createHmacHex } from './webhook-crypto'

describe('StripeStyleWebhookVerifier', () => {
  const verifier = new StripeStyleWebhookVerifier()
  const rawBody = Buffer.from('{"id":"evt_123"}')
  const secret = 'whsec_test'
  const now = 1_700_000_000_000
  const timestamp = Math.floor(now / 1000)

  it('accepts a valid stripe signature', () => {
    const signature = createHmacHex(secret, `${timestamp}.${rawBody.toString('utf8')}`)
    const result = verifier.verify({
      headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
      rawBody,
      secret,
      now,
      toleranceSeconds: 300,
    })

    expect(result).toEqual({ ok: true, timestamp })
  })

  it('rejects an invalid signature', () => {
    const result = verifier.verify({
      headers: { 'stripe-signature': `t=${timestamp},v1=bad` },
      rawBody,
      secret,
      now,
      toleranceSeconds: 300,
    })

    expect(result).toEqual({ ok: false, reason: 'WEBHOOK_SIGNATURE_INVALID' })
  })

  it('rejects timestamps outside the tolerance window', () => {
    const oldTimestamp = timestamp - 1000
    const signature = createHmacHex(secret, `${oldTimestamp}.${rawBody.toString('utf8')}`)
    const result = verifier.verify({
      headers: { 'stripe-signature': `t=${oldTimestamp},v1=${signature}` },
      rawBody,
      secret,
      now,
      toleranceSeconds: 300,
    })

    expect(result).toEqual({ ok: false, reason: 'WEBHOOK_TIMESTAMP_INVALID' })
  })

  it('rejects malformed signature headers', () => {
    const result = verifier.verify({
      headers: { 'stripe-signature': 'v1=missing-timestamp' },
      rawBody,
      secret,
      now,
      toleranceSeconds: 300,
    })

    expect(result).toEqual({ ok: false, reason: 'WEBHOOK_PAYLOAD_UNSUPPORTED' })
  })
})
