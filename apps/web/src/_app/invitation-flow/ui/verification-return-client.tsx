'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { VerifyEmailPage } from '@/_pages/auth'
import { invitationFlowClient } from '@/entities/invitation-flow'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Spinner } from '@/shared/ui/spinner'

export function VerificationReturn({
  selectorId,
  sessionBinding,
}: {
  selectorId: string
  sessionBinding: string | null
}) {
  const t = useTranslations('invitationRecipient')
  const started = useRef(false)
  const [result, setResult] = useState<{ flowId: string } | { error: unknown } | null>(null)
  useEffect(() => {
    if (!sessionBinding || started.current) return
    started.current = true
    // Single-use action: StrictMode cleanup must not dispatch a second consume request.
    void invitationFlowClient
      .verificationReturn(selectorId, sessionBinding, AbortSignal.timeout(10000))
      .then(
        (value) => setResult({ flowId: value.binding.flowId }),
        (error) => setResult({ error })
      )
  }, [selectorId, sessionBinding])
  if (!sessionBinding)
    return <p className="text-sm text-muted-foreground">{t('verificationReopen')}</p>
  if (!result)
    return (
      <div role="status" className="flex items-center justify-center gap-2">
        <Spinner />
        {t('verificationReturning')}
      </div>
    )
  if ('error' in result)
    return (
      <div className="space-y-2">
        <ApiErrorAlert error={result.error} />
        <p className="text-sm text-muted-foreground">{t('verificationReopen')}</p>
      </div>
    )
  return (
    <RouteProgressLink href={`/invite/flow/${result.flowId}`} className={buttonVariants()}>
      {t('returnToInvitation')}
    </RouteProgressLink>
  )
}

export function InvitationVerificationClient({
  token,
  selectorId,
  sessionBinding,
  successContent,
}: {
  token?: string
  selectorId: string
  sessionBinding: string | null
  successContent?: ReactNode
}) {
  const t = useTranslations('invitationRecipient')
  const help = (
    <div className="space-y-4 text-center">
      <p className="text-sm text-muted-foreground">{t('verificationHelp')}</p>
      <RouteProgressLink href="/resend-verification" className={buttonVariants()}>
        {t('resendVerification')}
      </RouteProgressLink>
      <p className="text-sm text-muted-foreground">{t('verificationReopen')}</p>
    </div>
  )
  return (
    <VerifyEmailPage
      token={token}
      withoutTokenContent={help}
      successContent={
        successContent ?? (
          <VerificationReturn selectorId={selectorId} sessionBinding={sessionBinding} />
        )
      }
    />
  )
}
