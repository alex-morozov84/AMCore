import { HttpStatus } from '@nestjs/common'

import { AppException } from '@/common/exceptions/domain'
import type { AiProviderType } from '@/generated/prisma/client'

/**
 * Bounded, machine-readable AI gateway error taxonomy (Track C — ADR-054, Arc B). Every failure
 * a caller/worker can see maps to one of these codes plus a `retryable` flag (the Arc C worker
 * uses it to decide retry vs terminal). A raw provider error is never surfaced — it is normalized
 * here, and no prompt/response content or credential is ever placed in the message or `details`.
 */
export const AI_GATEWAY_ERROR_CODES = [
  'model_not_found', // an explicit slug that is not in the enabled catalog
  'no_default_model', // default resolution found no credentialed default and no mock
  'model_not_configured', // the model's provider has no usable credential / no adapter
  'provider_timeout', // the provider call exceeded the request timeout
  'provider_unavailable', // transient provider/network failure
  'provider_rejected', // permanent provider rejection (bad request / auth / quota)
  'content_filtered', // the provider refused on safety grounds
  'capability_unsupported', // the model lacks the requested capability (e.g. structured output)
  'output_validation_failed', // structured output did not match the requested schema
] as const

export type AiGatewayErrorCode = (typeof AI_GATEWAY_ERROR_CODES)[number]

export class AiGatewayException extends AppException {
  constructor(
    readonly code: AiGatewayErrorCode,
    status: HttpStatus,
    readonly retryable: boolean,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message, status, code, details)
  }

  static modelNotFound(modelSlug: string): AiGatewayException {
    return new AiGatewayException(
      'model_not_found',
      HttpStatus.NOT_FOUND,
      false,
      'AI model not found',
      { modelSlug }
    )
  }

  static noDefaultModel(): AiGatewayException {
    return new AiGatewayException(
      'no_default_model',
      HttpStatus.SERVICE_UNAVAILABLE,
      false,
      'No usable default AI model is configured'
    )
  }

  static modelNotConfigured(modelSlug: string): AiGatewayException {
    return new AiGatewayException(
      'model_not_configured',
      HttpStatus.SERVICE_UNAVAILABLE,
      false,
      'AI model is not usable (missing credential or adapter)',
      { modelSlug }
    )
  }

  static providerTimeout(providerType: AiProviderType): AiGatewayException {
    return new AiGatewayException(
      'provider_timeout',
      HttpStatus.GATEWAY_TIMEOUT,
      true,
      'AI provider call timed out',
      { providerType }
    )
  }

  static providerUnavailable(providerType: AiProviderType): AiGatewayException {
    return new AiGatewayException(
      'provider_unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
      true,
      'AI provider is temporarily unavailable',
      { providerType }
    )
  }

  static providerRejected(providerType: AiProviderType): AiGatewayException {
    return new AiGatewayException(
      'provider_rejected',
      HttpStatus.BAD_GATEWAY,
      false,
      'AI provider rejected the request',
      { providerType }
    )
  }

  static contentFiltered(providerType: AiProviderType): AiGatewayException {
    return new AiGatewayException(
      'content_filtered',
      HttpStatus.UNPROCESSABLE_ENTITY,
      false,
      'AI provider refused to generate',
      { providerType }
    )
  }

  static capabilityUnsupported(modelSlug: string, capability: string): AiGatewayException {
    return new AiGatewayException(
      'capability_unsupported',
      HttpStatus.UNPROCESSABLE_ENTITY,
      false,
      'AI model does not support the requested capability',
      { modelSlug, capability }
    )
  }

  static outputValidationFailed(providerType: AiProviderType): AiGatewayException {
    return new AiGatewayException(
      'output_validation_failed',
      HttpStatus.BAD_GATEWAY,
      false,
      'AI provider output failed schema validation',
      { providerType }
    )
  }
}
