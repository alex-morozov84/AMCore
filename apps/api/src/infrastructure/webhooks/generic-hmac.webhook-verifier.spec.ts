import { GenericHmacWebhookVerifier } from './generic-hmac.webhook-verifier'
import { createHmacHex } from './webhook-crypto'

describe('GenericHmacWebhookVerifier', () => {
  const verifier = new GenericHmacWebhookVerifier()
  const secret = 'whsec_generic'
  const rawBody = Buffer.from('{"id":"msg_123"}')
  const now = 1_700_000_000_000
  const timestamp = Math.floor(now / 1000)

  it('accepts a standard-style generic HMAC signature', () => {
    const payload = `${'msg_123'}.${timestamp}.${rawBody.toString('utf8')}`
    const signature = `sha256=${createHmacHex(secret, payload)}`
    const result = verifier.verify(
      {
        headers: {
          'webhook-id': 'msg_123',
          'webhook-timestamp': String(timestamp),
          'webhook-signature': signature,
        },
        rawBody,
        secret,
        now,
        toleranceSeconds: 300,
      },
      {
        idHeader: 'webhook-id',
        timestampHeader: 'webhook-timestamp',
        signatureHeader: 'webhook-signature',
        signaturePrefix: 'sha256=',
        payloadFormat: 'standard',
      }
    )

    expect(result).toEqual({ ok: true, eventId: 'msg_123', timestamp })
  })

  it('accepts a github-style raw-body signature', () => {
    const signature = `sha256=${createHmacHex(secret, rawBody)}`
    const result = verifier.verify(
      {
        headers: { 'x-hub-signature-256': signature },
        rawBody,
        secret,
        now,
        toleranceSeconds: 300,
      },
      {
        signatureHeader: 'x-hub-signature-256',
        signaturePrefix: 'sha256=',
        payloadFormat: 'raw',
      }
    )

    expect(result).toEqual({ ok: true, eventId: 'raw', timestamp: 0 })
  })
})
