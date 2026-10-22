'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { useCurrentUser } from '@/entities/user'
import type { AuthActionBase } from '@/shared/api/auth-api'
import { cn } from '@/shared/lib/utils'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Spinner } from '@/shared/ui/spinner'

import { useVerifyEmail } from '../model/use-verify-email'

interface VerifyEmailStatusProps {
  /** The `?token=` query param `(auth)/verify-email/page.tsx` read from the
   * emailed link. Absent when the page is opened without one. */
  token?: string
  actionBase?: AuthActionBase
  loginHref?: string
  homeHref?: string
  resendHref?: string
  withoutTokenContent?: ReactNode
  successContent?: ReactNode
}

/**
 * Not a form — the token is the only input, and it comes from the URL, so
 * the mutation fires once on mount instead of waiting for a submit. The
 * `useRef` guard is what keeps that a single network call: without it,
 * React Strict Mode's dev double-invoke would fire it twice, and the
 * second call would hit the token's real single-use guard
 * (`used: true` after the first) and show a false failure.
 */
export function VerifyEmailStatus({
  token,
  withoutTokenContent,
  successContent,
  actionBase,
  loginHref = '/login',
  homeHref = '/',
  resendHref = '/resend-verification',
}: VerifyEmailStatusProps) {
  const t = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const { mutate, isSuccess, isError, error } = useVerifyEmail(actionBase)
  const { data: currentUser } = useCurrentUser()
  const fired = useRef(false)

  useEffect(() => {
    if (!token || fired.current) return
    fired.current = true
    mutate({ token })
  }, [token, mutate])

  if (!token) {
    if (withoutTokenContent) return withoutTokenContent
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-destructive">{tErrors('TOKEN_INVALID')}</p>
        <RouteProgressLink href={resendHref} className={cn(buttonVariants(), 'w-full')}>
          {t('resendVerification')}
        </RouteProgressLink>
      </div>
    )
  }

  if (isSuccess) {
    const destination = currentUser?.user ? homeHref : loginHref
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">{t('verifyEmailSuccess')}</p>
        {successContent}
        <RouteProgressLink href={destination} className={cn(buttonVariants(), 'w-full')}>
          {currentUser?.user ? t('goToDashboard') : t('login')}
        </RouteProgressLink>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-4 text-center">
        <ApiErrorAlert error={error} />
        <RouteProgressLink href={resendHref} className={cn(buttonVariants(), 'w-full')}>
          {t('resendVerification')}
        </RouteProgressLink>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Spinner />
      <p className="text-sm text-muted-foreground">{t('verifyingEmail')}</p>
    </div>
  )
}
