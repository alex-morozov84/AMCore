import { HttpStatus } from '@nestjs/common'

import type { WebhookFailureReason } from './webhook.types'

import { AppException } from '@/common/exceptions'

const WEBHOOK_STATUS: Record<WebhookFailureReason, HttpStatus> = {
  WEBHOOK_SIGNATURE_INVALID: HttpStatus.UNAUTHORIZED,
  WEBHOOK_TIMESTAMP_INVALID: HttpStatus.UNAUTHORIZED,
  WEBHOOK_REPLAY_REJECTED: HttpStatus.UNAUTHORIZED,
  WEBHOOK_CONFIGURATION_MISSING: HttpStatus.BAD_REQUEST,
  WEBHOOK_PAYLOAD_UNSUPPORTED: HttpStatus.BAD_REQUEST,
}

const WEBHOOK_MESSAGE: Record<WebhookFailureReason, string> = {
  WEBHOOK_SIGNATURE_INVALID: 'Invalid webhook signature',
  WEBHOOK_TIMESTAMP_INVALID: 'Invalid webhook signature',
  WEBHOOK_REPLAY_REJECTED: 'Invalid webhook signature',
  WEBHOOK_CONFIGURATION_MISSING: 'Webhook configuration is missing',
  WEBHOOK_PAYLOAD_UNSUPPORTED: 'Webhook payload is unsupported',
}

export function createWebhookException(reason: WebhookFailureReason): AppException {
  return new AppException(WEBHOOK_MESSAGE[reason], WEBHOOK_STATUS[reason], reason)
}
