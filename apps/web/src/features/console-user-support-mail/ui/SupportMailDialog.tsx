'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { SupportMailKind, SupportMailReceipt } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

import type { MailPhase } from '../model/use-support-mail'

function ReceiptBody({
  receipt,
  mailKind,
}: {
  receipt: SupportMailReceipt
  mailKind?: SupportMailKind
}) {
  const t = useTranslations('console.supportMail')
  const outcome = receipt.evidence === 'unconfirmed' ? 'unknown' : receipt.outcome
  const reason = receipt.evidence === 'unconfirmed' ? null : receipt.reason
  const usefulReason =
    reason &&
    (['not_started', 'refused'].includes(outcome) ||
      (outcome === 'unknown' && !['provider_failure', 'deadline', 'precheck'].includes(reason)))
  const detail =
    outcome === 'accepted' ||
    outcome === 'simulated' ||
    outcome === 'unknown' ||
    outcome === 'in_progress'
      ? t(`detail.${outcome}`)
      : null
  const next = outcome === 'not_started' || outcome === 'refused' ? t(`next.${outcome}`) : null
  const cancelled =
    receipt.tokenIssued === true
      ? t(mailKind ? `${mailKind}.replaced` : 'previousLinkCancelled')
      : receipt.evidence === 'unconfirmed' && receipt.tokenIssued === undefined
        ? t('linkMayBeReplaced')
        : null
  return (
    <>
      {detail && <p>{detail}</p>}
      {usefulReason && <p>{t(`reason.${reason}`)}</p>}
      {(cancelled || next) && (
        <p className="text-sm text-muted-foreground">
          {[cancelled, next].filter(Boolean).join(' ')}
        </p>
      )}
    </>
  )
}

export function SupportMailDialog({
  phase,
  onClose,
  onCheck,
  finalFocus,
}: {
  finalFocus: () => HTMLElement | null
  phase: MailPhase
  onClose: () => void
  onCheck: () => void
}) {
  const t = useTranslations('console.supportMail')
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = ['sending', 'checking', 'preparing'].includes(phase.kind)
  const receipt = phase.receipt
  const outcome = receipt?.evidence === 'unconfirmed' ? 'unknown' : receipt?.outcome
  const mailKind = receipt?.evidence !== 'unconfirmed' && receipt ? receipt.kind : phase.mailKind
  const open = busy || phase.kind === 'result' || phase.kind === 'error'
  const title = busy
    ? t(
        phase.kind === 'checking'
          ? 'checking'
          : phase.kind === 'preparing'
            ? 'preparing'
            : 'sending'
      )
    : outcome
      ? t(`outcomeTitle.${outcome}`)
      : t('sendFailed')
  if (!open) return null
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        closeLabel={t('close')}
        initialFocus={heading}
        finalFocus={finalFocus}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle ref={heading} tabIndex={-1}>
            {title}
          </DialogTitle>
          <DialogDescription>
            {mailKind ? t(`${mailKind}.title`) : t('title')}
            {receipt?.evidence !== 'unconfirmed' && receipt?.attemptedAt && (
              <span className="mt-1 block text-xs">
                <ConsoleTimestamp value={receipt.attemptedAt} variant="inline" />
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3" aria-live="polite" aria-busy={busy}>
          {phase.message && <p role="alert">{phase.message}</p>}
          {receipt && <ReceiptBody receipt={receipt} mailKind={mailKind} />}
          {busy && (
            <p className="text-sm text-muted-foreground">
              {t(
                phase.kind === 'preparing'
                  ? 'prepareHelp'
                  : phase.kind === 'checking' && !phase.preparation
                    ? 'readingHelp'
                    : 'closePending'
              )}
            </p>
          )}
        </div>
        <DialogFooter>
          {!busy && (outcome === 'unknown' || outcome === 'in_progress') && (
            <Button variant="outline" onClick={onCheck}>
              {t('check')}
            </Button>
          )}
          <Button onClick={onClose}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
