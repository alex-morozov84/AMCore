'use client'

import { useTranslations } from 'next-intl'

import { useApiError } from '../api/use-api-error'

import { Alert, AlertDescription } from './alert'

interface ApiErrorAlertProps {
  /** Anything thrown by a mutation or query. Renders nothing when nullish. */
  error: unknown
  className?: string
}

/**
 * Renders an API failure as localized text, keyed on its error code.
 *
 * Centralised so every surface shows failures the same way and no screen
 * re-invents the fallback. When the code could not be translated, the
 * correlation ID is shown alongside the generic message — it is what support
 * needs to find the request, and it is the only useful thing left once the
 * backend's own (English, developer-facing) message is deliberately withheld.
 */
export function ApiErrorAlert({ error, className }: ApiErrorAlertProps) {
  const t = useTranslations('errors')
  const describe = useApiError()

  if (!error) return null

  const { message, correlationId, isUnknown } = describe(error)

  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>
        {message}
        {isUnknown && correlationId && (
          <span className="mt-1 block text-xs opacity-80">
            {t('correlationHint', { id: correlationId })}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
