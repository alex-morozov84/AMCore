'use client'

import { useTranslations } from 'next-intl'
import type { IntegrationItem } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'

import { useProbeFlow } from '../model/use-probe-flow'

import { ProbeResultDialog } from './ProbeResultDialog'

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
        <ProbeResultDialog
          phase={phase}
          item={item}
          onClose={flow.close}
          onRestart={() => void flow.start()}
        />
      )}
    </div>
  )
}
