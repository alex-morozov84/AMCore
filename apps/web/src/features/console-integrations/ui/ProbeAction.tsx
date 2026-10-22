'use client'

import { useTranslations } from 'next-intl'
import type { IntegrationItem, ProbeReceipt } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

import { type ProbePhase, useProbeFlow } from '../model/use-probe-flow'

type Next = 'limit' | 'accepted' | 'refused' | 'unknown' | 'not_started'

function outcomeNext(receipt: ProbeReceipt): Next | null {
  if (receipt.class === 'rate_limit' || receipt.class === 'quota') return 'limit'
  if (receipt.outcome === 'accepted') return 'accepted'
  if (receipt.outcome === 'refused') return 'refused'
  if (receipt.outcome === 'unknown') return 'unknown'
  if (receipt.outcome === 'not_started') return 'not_started'
  return null
}

function ReceiptBody({ receipt }: { receipt: ProbeReceipt }) {
  const t = useTranslations('console.integrations.probe.operator_email_test')
  const next = outcomeNext(receipt)
  return (
    <div className="space-y-2">
      <p className="font-medium">{t(`outcome.${receipt.outcome}`)}</p>
      {next && <p className="text-muted-foreground">{t(`next.${next}`)}</p>}
      <p className="text-xs text-muted-foreground">
        <ConsoleTimestamp
          value={receipt.settledAt ?? receipt.reservedAt}
          variant="inline"
          seconds
        />
      </p>
    </div>
  )
}

function ResultDialog({
  phase,
  item,
  onClose,
  onRestart,
}: {
  phase: ProbePhase
  item: IntegrationItem
  onClose: () => void
  onRestart: () => void
}) {
  const t = useTranslations('console.integrations.probe.operator_email_test')
  const integrations = useTranslations('console.integrations')
  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  const open =
    busy ||
    phase.kind === 'result' ||
    phase.kind === 'latest' ||
    phase.kind === 'notStored' ||
    phase.kind === 'unreadable' ||
    phase.kind === 'failed'
  if (!open) return null
  const title =
    phase.kind === 'sending'
      ? t('sendingTitle')
      : phase.kind === 'checking'
        ? t('checkingTitle')
        : t('resultTitle')
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription render={<div />}>
            {phase.kind === 'sending' && t('sendingBody')}
            {phase.kind === 'checking' && t('checkingBody')}
            {phase.kind === 'result' && <ReceiptBody receipt={phase.receipt} />}
            {phase.kind === 'notStored' && t('notStored')}
            {phase.kind === 'unreadable' && (
              <span className="space-y-2">
                <span className="block font-medium">{t('outcome.unknown')}</span>
                <span className="block text-muted-foreground">{t('next.unknown')}</span>
              </span>
            )}
            {phase.kind === 'failed' && phase.message}
            {phase.kind === 'latest' && (
              <span className="space-y-1">
                <span className="block text-xs">{t('latestFromRow')}</span>
                <span className="block font-medium">
                  {item.evidence.result === 'none'
                    ? integrations('noStoredResult')
                    : integrations(`result.${item.evidence.result}`)}
                </span>
                {item.evidence.checkedAt && (
                  <ConsoleTimestamp value={item.evidence.checkedAt} variant="inline" seconds />
                )}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {!busy && (
          <DialogFooter>
            {phase.kind === 'failed' && phase.canRestart && (
              <Button variant="outline" onClick={onRestart}>
                {t('startAgain')}
              </Button>
            )}
            <Button onClick={onClose}>{t('close')}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The only action of the page: "Send test email" with its confirmation, step-up, result and a
 * read-only "Last test" reopen. The registration supplies none of this copy: the closed probe kind
 * selects it. Refresh and reopen never send mail.
 */
export function ProbeAction({ item }: { item: IntegrationItem }) {
  const action = item.action
  const t = useTranslations('console.integrations.probe.operator_email_test')
  const flow = useProbeFlow(item.id, action?.ownAttemptId ?? null)
  if (!action) return null
  const { phase } = flow
  const idle = phase.kind === 'idle'
  const reason = action.unavailableReason
  const hasLast = Boolean(action.ownAttemptId) || item.evidence.checkedAt !== null
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        disabled={!action.available || !idle}
        aria-busy={phase.kind === 'preparing'}
        onClick={() => void flow.start()}
      >
        {phase.kind === 'preparing' ? t('preparing') : t('button')}
      </Button>
      {reason && (
        <p className="max-w-56 text-xs text-muted-foreground">
          {t(`unavailable.${reason}`)}
          {reason === 'cooldown' && action.cooldownRemainingSeconds > 0
            ? ` (${action.cooldownRemainingSeconds} s)`
            : ''}
        </p>
      )}
      {hasLast && idle && (
        <Button variant="link" className="h-auto p-0" onClick={flow.reopen}>
          {t('lastTest')} ›
        </Button>
      )}
      <ConfirmDialog
        open={phase.kind === 'confirm'}
        onOpenChange={(open) => !open && flow.close()}
        title={t('confirmTitle')}
        description={
          phase.kind === 'confirm'
            ? t('confirmDescription', { recipient: phase.prepared.recipientHint })
            : ''
        }
        confirmLabel={t('confirmAction')}
        cancelLabel={t('cancel')}
        onConfirm={flow.confirm}
      />
      <ConsoleStepUpDialog
        phase={flow.mutation.stepUp}
        isSubmitting={flow.mutation.isSteppingUp}
        onSubmit={flow.mutation.submitStepUp}
        onClose={flow.close}
      />
      {flow.mutation.stepUp.kind === 'closed' && (
        <ResultDialog
          phase={phase}
          item={item}
          onClose={flow.close}
          onRestart={() => void flow.start()}
        />
      )}
    </div>
  )
}
