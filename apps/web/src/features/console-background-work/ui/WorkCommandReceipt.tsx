'use client'

import { useTranslations } from 'next-intl'
import type { WorkReceipt } from '@amcore/shared'

import { ApiRequestError } from '@/shared/api'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { CopyConsoleId } from '@/shared/ui/console-detail/CopyConsoleId'
import { Disclosure } from '@/shared/ui/disclosure'

import { WorkUnknownDisposition } from './WorkUnknownDisposition'

export function WorkCommandReceipt({
  receipt,
  commandId,
  error,
  reading,
  refresh,
}: {
  receipt: WorkReceipt | null
  commandId: string
  error: unknown
  reading: boolean
  refresh(): void
}) {
  const t = useTranslations('console.backgroundWork.control')
  const errors = useTranslations('errors')
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={t('receiptTitle')}>
      <h3 className="font-medium">{t('receiptTitle')}</h3>
      <Disclosure label={t('technicalDetails')}>
        <div className="flex items-center gap-2 text-sm">
          <span>{t('commandId')}</span>
          <code className="break-all text-xs">{commandId}</code>
          <CopyConsoleId
            id={commandId}
            label={t('copyId')}
            copied={t('copied')}
            failed={t('copyFailed')}
          />
        </div>
      </Disclosure>
      {error instanceof ApiRequestError && error.status === 404 ? (
        <p role="status" className="text-sm text-warning">
          {t('receiptMissing')}
        </p>
      ) : (
        <ApiErrorAlert error={error} />
      )}
      <p role="status">
        {receipt
          ? t(`receiptStates.${receipt.state}`)
          : error
            ? t('receiptReadFailed')
            : reading
              ? t('awaitingReceipt')
              : t('unconfirmed')}
      </p>
      {receipt && (
        <>
          <p className="text-sm text-muted-foreground">{t('receiptMeaning')}</p>
          {receipt.unknownCount > 0 && (
            <p role="status" className="text-sm text-warning">
              {t('unknownCount', { count: receipt.unknownCount })}
            </p>
          )}
          <ul className="space-y-2">
            {receipt.targets.map((target) => (
              <li key={target.id} className="text-sm">
                <span className="font-console-mono">{target.id}</span>
                {t('separator')}
                {t(`targetStates.${target.state}`)}
                {target.deadlineExceeded && <p>{t('deadlineUnconfirmed')}</p>}
                {target.reason && <p className="text-muted-foreground">{errors(target.reason)}</p>}
                {target.resolution !== 'none' && <p>{t(`resolutions.${target.resolution}`)}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      <Button type="button" variant="outline" disabled={reading} onClick={refresh}>
        {t('readReceipt')}
      </Button>
      {receipt &&
        receipt.targets.some(
          (target) => target.state === 'unknown' && target.resolution === 'none'
        ) &&
        !receipt.targets.some((target) => ['prepared', 'dispatching'].includes(target.state)) && (
          <WorkUnknownDisposition
            subject={{ kind: 'command', id: receipt.commandId, revision: receipt.revision }}
            refresh={refresh}
          />
        )}
    </section>
  )
}
