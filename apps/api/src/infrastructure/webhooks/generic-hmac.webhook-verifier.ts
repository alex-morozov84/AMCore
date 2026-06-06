import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import type {
  GenericHmacWebhookOptions,
  WebhookVerificationInput,
  WebhookVerificationResult,
  WebhookVerifier,
} from './webhook.types'
import { constantTimeEquals, createHmacHex } from './webhook-crypto'

const standardHeadersSchema = z.object({
  id: z.string().min(1),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(1),
})

@Injectable()
export class GenericHmacWebhookVerifier implements WebhookVerifier<GenericHmacWebhookOptions> {
  verify(
    input: WebhookVerificationInput,
    options: GenericHmacWebhookOptions
  ): WebhookVerificationResult {
    const extracted = extractHeaders(input.headers, options)
    if (!extracted) return { ok: false, reason: 'WEBHOOK_PAYLOAD_UNSUPPORTED' }
    if (!timestampAllowed(extracted.timestamp, input)) {
      return { ok: false, reason: 'WEBHOOK_TIMESTAMP_INVALID' }
    }

    const signedPayload = buildPayload(extracted.id, extracted.timestamp, input.rawBody, options)
    const expected = `${options.signaturePrefix}${createHmacHex(input.secret, signedPayload)}`
    if (!constantTimeEquals(extracted.signature, expected)) {
      return { ok: false, reason: 'WEBHOOK_SIGNATURE_INVALID' }
    }

    return { ok: true, eventId: extracted.id, timestamp: extracted.timestamp }
  }
}

function extractHeaders(
  headers: WebhookVerificationInput['headers'],
  options: GenericHmacWebhookOptions
): { id: string; timestamp: number; signature: string } | null {
  if (options.payloadFormat === 'raw') {
    const signature = getHeader(headers, options.signatureHeader)
    return signature ? { id: 'raw', timestamp: 0, signature } : null
  }

  const parsed = standardHeadersSchema.safeParse({
    id: getHeader(headers, options.idHeader),
    timestamp: getHeader(headers, options.timestampHeader),
    signature: getHeader(headers, options.signatureHeader),
  })
  return parsed.success ? parsed.data : null
}

function buildPayload(
  id: string,
  timestamp: number,
  rawBody: Buffer,
  options: GenericHmacWebhookOptions
): Buffer | string {
  if (options.payloadFormat === 'raw') return rawBody
  return Buffer.concat([Buffer.from(`${id}.${timestamp}.`), rawBody])
}

function getHeader(
  headers: WebhookVerificationInput['headers'],
  name: string | undefined
): string | undefined {
  if (!name) return undefined
  const value = headers[name.toLowerCase()]
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
}

function timestampAllowed(timestamp: number, input: WebhookVerificationInput): boolean {
  if (timestamp === 0) return true
  const delta = Math.abs(input.now - timestamp * 1000)
  return delta <= input.toleranceSeconds * 1000
}
