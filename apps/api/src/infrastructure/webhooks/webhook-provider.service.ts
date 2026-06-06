import type { IncomingHttpHeaders } from 'node:http'

import { Injectable } from '@nestjs/common'

import { GenericHmacWebhookVerifier } from './generic-hmac.webhook-verifier'
import { StripeStyleWebhookVerifier } from './stripe-style.webhook-verifier'
import type {
  GenericHmacWebhookOptions,
  ResolvedWebhookProvider,
  WebhookProvider,
  WebhookVerificationInput,
} from './webhook.types'

import { EnvService } from '@/env/env.service'

const GENERIC_OPTIONS: GenericHmacWebhookOptions = {
  idHeader: 'webhook-id',
  timestampHeader: 'webhook-timestamp',
  signatureHeader: 'webhook-signature',
  signaturePrefix: 'sha256=',
  payloadFormat: 'standard',
}

@Injectable()
export class WebhookProviderService {
  constructor(
    private readonly env: EnvService,
    private readonly stripe: StripeStyleWebhookVerifier,
    private readonly generic: GenericHmacWebhookVerifier
  ) {}

  resolve(provider: WebhookProvider): ResolvedWebhookProvider {
    const secret = this.env.get('WEBHOOK_SECRETS')[provider]
    if (provider === 'stripe') return stripeProvider(secret, this.stripe)
    return genericProvider(secret, this.generic)
  }
}

function stripeProvider(
  secret: string | undefined,
  verifier: StripeStyleWebhookVerifier
): ResolvedWebhookProvider {
  return {
    provider: 'stripe',
    secret,
    verify: (input: WebhookVerificationInput) => verifier.verify(input),
    replayId: (_headers: IncomingHttpHeaders, body: unknown) => bodyId(body),
  }
}

function genericProvider(
  secret: string | undefined,
  verifier: GenericHmacWebhookVerifier
): ResolvedWebhookProvider {
  return {
    provider: 'generic',
    secret,
    verify: (input: WebhookVerificationInput) => verifier.verify(input, GENERIC_OPTIONS),
    replayId: (headers: IncomingHttpHeaders) => headerValue(headers, 'webhook-id'),
  }
}

function bodyId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const id = (body as Record<string, unknown>).id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
}
