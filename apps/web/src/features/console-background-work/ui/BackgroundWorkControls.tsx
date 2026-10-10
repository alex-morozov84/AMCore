'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { type WorkJob, type WorkOperation, type WorkSummary } from '@amcore/shared'

import { ApiRequestError } from '@/shared/api'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { toast } from '@/shared/ui/toast'

import { useBackgroundCommand } from '../model/use-background-command'

import { WorkCard } from './WorkCard'
import { WorkCommandConfirmation } from './WorkCommandConfirmation'
import { WorkCommandReceipt } from './WorkCommandReceipt'
import { WorkJobs } from './WorkJobs'

type Selection = { work: WorkSummary; operation: WorkOperation; targets?: WorkJob[] }

/** One registration-driven control surface. Captured confirmation is independent of live catalogue data. */
export function BackgroundWorkControls({
  initial,
  error,
  onRefresh,
}: {
  initial: WorkSummary[]
  error?: unknown
  onRefresh?(): void
}) {
  const t = useTranslations('console.backgroundWork.control')
  const common = useTranslations('common')
  const [closedResultId, setClosedResultId] = useState<string | null>(null)
  const notified = useRef<string | null>(null)
  const [confirmationSubmitted, setConfirmationSubmitted] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [openWork, setOpenWork] = useState<string | null>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const command = useBackgroundCommand()
  const router = useRouteProgressRouter()
  const refresh = useEffectEvent(() => {
    if (onRefresh) onRefresh()
    else router.refresh()
  })
  const receiptSettled =
    !!command.receipt &&
    !command.receipt.targets.some(
      (target) =>
        ['prepared', 'dispatching'].includes(target.state) ||
        (target.state === 'unknown' && target.resolution === 'none')
    )
  useEffect(() => {
    if (receiptSettled) refresh()
  }, [command.receipt?.commandId, command.receipt?.revision, receiptSettled])
  const applied =
    !!command.receipt &&
    command.receipt.state === 'applied' &&
    command.receipt.unknownCount === 0 &&
    command.receipt.targets.every((target) => target.state === 'applied')
  const finish = useEffectEvent(() => {
    if (!command.receipt || notified.current === command.receipt.commandId) return
    notified.current = command.receipt.commandId
    toast.add({ type: 'success', title: t(`success.${command.receipt.operation}`) })
    setSelection(null)
    command.dismissSuccessfulReceipt()
  })
  useEffect(() => {
    if (applied && confirmationSubmitted && command.command) finish()
  }, [applied, confirmationSubmitted, command.command, command.receipt?.commandId])
  const busy = command.isSubmitting || command.isSteppingUp || command.stepUp.kind !== 'closed'
  const accessLost = error instanceof ApiRequestError && [401, 403].includes(error.status)
  const uncertainWork =
    command.unconfirmed ||
    command.receipt?.targets.some(
      (target) =>
        ['prepared', 'dispatching'].includes(target.state) ||
        (target.state === 'unknown' && target.resolution === 'none')
    )
  const pendingWorkId = command.command?.workId ?? command.receipt?.workId
  return (
    <section className="space-y-3" aria-label={t('title')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        {!selection && command.receiptId && (
          <Button variant="outline" onClick={() => setClosedResultId(null)}>
            {t('readReceipt')}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('sectionDescription')}</p>
      <ApiErrorAlert error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {!accessLost &&
          initial.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              selected={openWork === work.id}
              blocked={busy || !!error || (pendingWorkId === work.id && !!uncertainWork)}
              onInspect={() => setOpenWork(work.id)}
              onCapture={(operation, trigger) => {
                returnFocus.current = trigger
                setConfirmationSubmitted(false)
                setSelection({ work: structuredClone(work), operation })
              }}
            />
          ))}
      </div>
      {!accessLost &&
        initial
          .filter((work) => work.id === openWork)
          .map((work) => (
            <WorkJobs
              key={work.id}
              work={work}
              blocked={busy || !!error || (pendingWorkId === work.id && !!uncertainWork)}
              onCapture={(operation, targets, trigger) => {
                returnFocus.current = trigger
                setConfirmationSubmitted(false)
                setSelection({ work: structuredClone(work), operation, targets })
              }}
            />
          ))}
      {!selection && command.receiptId && (
        <Dialog
          open={closedResultId !== command.receiptId}
          onOpenChange={(open) => {
            if (!open) setClosedResultId(command.receiptId)
          }}
        >
          <DialogContent
            closeLabel={common('close')}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle>{t('receiptTitle')}</DialogTitle>
              <DialogDescription>{t('receiptMeaning')}</DialogDescription>
            </DialogHeader>
            <WorkCommandReceipt
              receipt={command.receipt}
              commandId={command.receiptId}
              error={command.receiptError}
              reading={command.isReadingReceipt}
              refresh={() => void command.refreshReceipt()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setClosedResultId(command.receiptId)}>
                {common('close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {selection && (
        <WorkCommandConfirmation
          key={`${selection.work.id}:${selection.work.revision}`}
          {...selection}
          finalFocus={returnFocus}
          open={command.stepUp.kind === 'closed'}
          pending={busy}
          error={
            confirmationSubmitted && !command.receipt && !command.unconfirmed ? command.error : null
          }
          result={
            confirmationSubmitted &&
            (command.receipt || command.unconfirmed) &&
            command.receiptId ? (
              <WorkCommandReceipt
                receipt={command.receipt}
                commandId={command.receiptId}
                error={command.receiptError}
                reading={command.isReadingReceipt}
                refresh={() => void command.refreshReceipt()}
              />
            ) : null
          }
          onClose={() => {
            const closedCommandId = command.receiptId
            setClosedResultId(closedCommandId)
            setSelection(null)
            if (command.unconfirmed || (command.receipt && !applied)) {
              toast.add({
                type: 'warning',
                title: t('receiptTitle'),
                description: command.receipt
                  ? t(`receiptStates.${command.receipt.state}`)
                  : t('unconfirmed'),
                actionProps: {
                  children: t('readReceipt'),
                  onClick: () => {
                    if (closedCommandId && command.openReceipt(closedCommandId)) {
                      setSelection(null)
                      setConfirmationSubmitted(false)
                      setClosedResultId(null)
                    }
                  },
                },
              })
            }
          }}
          onConfirm={(reason, cutoff) => {
            if (!selection.work.revision) return
            if (
              command.prepare({
                contractVersion: 1,
                workId: selection.work.id,
                operation: selection.operation,
                targets: selection.targets?.map((row) => row.identity) ?? [],
                expectedWorkRevision: selection.work.revision,
                reason,
                parameters:
                  selection.operation === 'cleanup'
                    ? {
                        cutoff,
                        states: [
                          ...new Set(
                            selection.targets!.map((row) => row.state as 'completed' | 'failed')
                          ),
                        ],
                      }
                    : {},
              })
            ) {
              setConfirmationSubmitted(true)
              void command.confirm()
            }
          }}
        />
      )}
      <ConsoleStepUpDialog
        phase={command.stepUp}
        isSubmitting={command.isSteppingUp}
        onSubmit={(password) => void command.submitStepUp(password)}
        onClose={command.closeStepUp}
      />
    </section>
  )
}
