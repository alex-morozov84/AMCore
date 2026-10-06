'use client'

import { useTranslations } from 'next-intl'

import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'

type Status =
  | { state: 'verify_email'; email: string; busy: boolean; onRefresh(): void; onResend(): void; onHelp?(): void }
  | { state: 'wrong_account'; email: string; busy: boolean; onSwitch(): void }
  | { state: 'authenticating'; busy?: boolean; onRefresh?(): void }
  | { state: 'completing_signin'; busy: boolean; onConfirm(): void }
  | { state: 'unusable' }
  | { state: 'unavailable'; busy: boolean; onRefresh(): void }
  | { state: 'changed' }
  | { state: 'unresolved'; busy: boolean; onRefresh(): void }
  | { state: 'already_access' | 'joined'; organization: string; onOpen(): void }
  | { state: 'access_removed' }
export type RecipientStatusProps = Status & { error?: unknown; onLeave(): void }
const titles = {
  verify_email: 'verifyTitle', wrong_account: 'wrongAccountTitle', authenticating: 'authenticatingTitle',
  completing_signin: 'completingTitle', unusable: 'unusableTitle', already_access: 'alreadyAccessTitle',
  joined: 'joinedTitle', access_removed: 'accessRemovedTitle',
  unavailable: 'unavailableTitle', changed: 'changedTitle', unresolved: 'unresolvedTitle',
} as const
const descriptions = {
  verify_email: 'verifyHelp', wrong_account: 'wrongAccountHelp', authenticating: 'authenticatingHelp',
  completing_signin: 'completingHelp', unusable: 'unusableHelp', already_access: 'alreadyAccessHelp',
  joined: 'joinedHelp', access_removed: 'accessRemovedHelp',
  unavailable: 'unavailableHelp', changed: 'changedHelp', unresolved: 'unresolvedHelp',
} as const

function StatusActions(props: RecipientStatusProps) {
  const t = useTranslations('invitationRecipient')
  if (props.state === 'authenticating' && props.onRefresh)
    return <Button variant="outline" disabled={props.busy} onClick={props.onRefresh}>{t('checkSignIn')}</Button>
  if (props.state === 'unavailable' || props.state === 'unresolved')
    return <Button disabled={props.busy} onClick={props.onRefresh}>{t('retry')}</Button>
  if (props.state === 'verify_email') return <>
    <Button disabled={props.busy} onClick={props.onRefresh}>{t('checkVerification')}</Button>
    <Button variant="outline" disabled={props.busy} onClick={props.onResend}>{t('resendVerification')}</Button>
    {props.onHelp && <Button variant="outline" disabled={props.busy} onClick={props.onHelp}>{t('verificationHelpAction')}</Button>}
  </>
  if (props.state === 'wrong_account') return <Button disabled={props.busy} onClick={props.onSwitch}>{t('switchAccount')}</Button>
  if (props.state === 'completing_signin') return <Button disabled={props.busy} onClick={props.onConfirm}>{t('confirmSignIn')}</Button>
  if (props.state === 'already_access' || props.state === 'joined') return <Button onClick={props.onOpen}>{t('openOrganization')}</Button>
  return null
}

/** Terminal/progress presentation receives current safe data only; no effects, token handling or joining. */
export function RecipientStatus(props: RecipientStatusProps) {
  const t = useTranslations('invitationRecipient')
  const busy = 'busy' in props && props.busy
  return <section className="space-y-6" aria-busy={busy || props.state === 'authenticating'}>
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">{t(titles[props.state])}</h1>
      {'email' in props && <p className="text-sm text-muted-foreground">{t('currentAccount', { email: props.email })}</p>}
      {'organization' in props && <p className="font-medium">{props.organization}</p>}
      <p className="text-sm text-muted-foreground" aria-live="polite">{t(descriptions[props.state])}</p>
    </div>
    <ApiErrorAlert error={props.error} />
    <div className="flex flex-wrap gap-3">
      <StatusActions {...props} />
      <Button variant="outline" onClick={props.onLeave}>{t('leave')}</Button>
    </div>
  </section>
}
