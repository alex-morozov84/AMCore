'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription } from '@/shared/ui/alert'

/**
 * The account exists but the browser session could not be started. One copy owner:
 * the `errors` entry for `REGISTRATION_SIGN_IN_REQUIRED`. A polite status (not an
 * alert) that takes focus once, so it is announced once and keyboard users land on it.
 */
export function RegistrationCreatedNotice() {
  const t = useTranslations('errors')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <Alert ref={ref} role="status" tabIndex={-1}>
      <AlertDescription>{t('REGISTRATION_SIGN_IN_REQUIRED')}</AlertDescription>
    </Alert>
  )
}
