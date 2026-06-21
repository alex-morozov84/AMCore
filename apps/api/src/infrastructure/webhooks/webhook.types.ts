import type { IncomingHttpHeaders } from 'node:http'

export type WebhookProvider = 'stripe' | 'generic' | 'telegram'

export type WebhookFailureReason =
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_TIMESTAMP_INVALID'
  | 'WEBHOOK_REPLAY_REJECTED'
  | 'WEBHOOK_CONFIGURATION_MISSING'
  | 'WEBHOOK_PAYLOAD_UNSUPPORTED'

export interface WebhookVerificationInput {
  headers: IncomingHttpHeaders
  rawBody: Buffer
  secret: string
  now: number
  toleranceSeconds: number
}

export interface WebhookVerificationSuccess {
  ok: true
  eventId?: string
  timestamp?: number
}

export interface WebhookVerificationFailure {
  ok: false
  reason: Exclude<WebhookFailureReason, 'WEBHOOK_REPLAY_REJECTED' | 'WEBHOOK_CONFIGURATION_MISSING'>
}

export type WebhookVerificationResult = WebhookVerificationSuccess | WebhookVerificationFailure

export interface WebhookVerifier<TOptions> {
  verify(input: WebhookVerificationInput, options: TOptions): WebhookVerificationResult
}

export type GenericHmacPayloadFormat = 'raw' | 'standard'

export interface GenericHmacWebhookOptions {
  idHeader?: string
  timestampHeader?: string
  signatureHeader: string
  signaturePrefix: string
  payloadFormat: GenericHmacPayloadFormat
}

export interface ResolvedWebhookProvider {
  provider: WebhookProvider
  secret: string | undefined
  verify(input: WebhookVerificationInput): WebhookVerificationResult
  replayId(headers: IncomingHttpHeaders, body: unknown): string | undefined
}
