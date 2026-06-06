import { Injectable } from '@nestjs/common'

import type {
  WebhookVerificationInput,
  WebhookVerificationResult,
  WebhookVerifier,
} from './webhook.types'
import { constantTimeEquals, createHmacHex } from './webhook-crypto'

@Injectable()
export class StripeStyleWebhookVerifier implements WebhookVerifier<void> {
  verify(input: WebhookVerificationInput): WebhookVerificationResult {
    const parsed = parseStripeSignature(input.headers['stripe-signature'])
    if (!parsed) return { ok: false, reason: 'WEBHOOK_PAYLOAD_UNSUPPORTED' }

    const payload = Buffer.concat([Buffer.from(`${parsed.timestamp}.`), input.rawBody])
    const expected = createHmacHex(input.secret, payload)
    const valid = parsed.signatures.some((signature) => constantTimeEquals(signature, expected))
    if (!valid) return { ok: false, reason: 'WEBHOOK_SIGNATURE_INVALID' }
    if (!timestampAllowed(parsed.timestamp, input)) {
      return { ok: false, reason: 'WEBHOOK_TIMESTAMP_INVALID' }
    }

    return { ok: true, timestamp: parsed.timestamp }
  }
}

function parseStripeSignature(
  header: string | string[] | undefined
): { timestamp: number; signatures: string[] } | null {
  const value = typeof header === 'string' ? header : Array.isArray(header) ? header[0] : undefined
  if (!value) return null

  const parts = value.split(',').map((part) => part.trim())
  const timestamp = Number(parts.find((part) => part.startsWith('t='))?.slice(2))
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
    .filter((part) => part.length > 0)

  if (!Number.isInteger(timestamp) || timestamp <= 0 || signatures.length === 0) return null
  return { timestamp, signatures }
}

function timestampAllowed(timestamp: number, input: WebhookVerificationInput): boolean {
  const delta = Math.abs(input.now - timestamp * 1000)
  return delta <= input.toleranceSeconds * 1000
}
