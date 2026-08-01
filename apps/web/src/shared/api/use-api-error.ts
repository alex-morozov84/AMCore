'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'

import { ClientErrorCode } from './error-codes'
import { getCorrelationId, getDiagnosticMessage, resolveErrorCode } from './errors'

export interface ApiErrorView {
  /** The machine-readable code the message was resolved from. */
  code: string
  /** Localized, user-facing text. Never the backend's own message. */
  message: string
  /** Present when the backend supplied one; show it so support can find the request. */
  correlationId?: string
  /** True when the code had no translation and the generic message was used. */
  isUnknown: boolean
}

/**
 * Translate any thrown value into user-facing text, keyed on its error code.
 *
 * This is the frontend half of ADR-023: the backend emits stable codes, the
 * client owns presentation. An untranslated code falls back to a generic
 * message plus the `correlationId` — **never** the backend's English prose,
 * which is developer-facing and would recreate the defect this replaces.
 *
 * A missing translation should be impossible: `error-messages.test.ts` fails
 * the build when a shared enum value has no catalogue entry. The dev-mode
 * warning below exists for the case that guard cannot cover — a code coming
 * from a backend newer than this client.
 */
export function useApiError() {
  const t = useTranslations('errors')

  return useCallback(
    (error: unknown): ApiErrorView => {
      const code = resolveErrorCode(error)
      const correlationId = getCorrelationId(error)

      // The code arrives over the network, so it cannot be a statically known
      // key. The cast is anchored to this translator's own key type rather
      // than `any`, and `t.has` guards the lookup at runtime.
      const key = code as Parameters<typeof t.has>[0]
      const hasMessage = t.has(key)

      if (!hasMessage && process.env.NODE_ENV !== 'production') {
        console.warn(
          `[i18n] No translation for error code "${code}". ` +
            `Add it to every catalogue in apps/web/messages/. ` +
            `Backend message (not shown to users): ${getDiagnosticMessage(error) ?? 'n/a'}`
        )
      }

      return {
        code,
        message: hasMessage ? t(key) : t(ClientErrorCode.UNKNOWN_ERROR),
        correlationId,
        isUnknown: !hasMessage,
      }
    },
    [t]
  )
}
