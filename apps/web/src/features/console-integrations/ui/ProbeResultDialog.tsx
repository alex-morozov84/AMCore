'use client'

import { useTranslations } from 'next-intl'
import type { IntegrationItem, ProbeReceipt } from '@amcore/shared'

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

import type { ProbePhase } from '../model/use-probe-flow'

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
  const failures = useTranslations('console.integrations.failure')
  const reason = receipt.class && failures.has(receipt.class) ? failures(receipt.class) : null
  const next = outcomeNext(receipt)
  return (
    <div className="space-y-2">
      <p className="font-medium">{t(`outcome.${receipt.outcome}`)}</p>
      {reason && receipt.outcome === 'refused' && <p>{reason}</p>}
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

export function ProbeResultDialog({
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
