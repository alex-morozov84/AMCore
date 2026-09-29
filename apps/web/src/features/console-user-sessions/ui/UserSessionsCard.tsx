'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { AdminSession } from '@amcore/shared'
import { RefreshCw } from 'lucide-react'

import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { DetailRelationRowsSkeleton } from '@/shared/ui/console-detail/DetailResultsSkeleton'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'
import { PaginationButtons } from '@/shared/ui/pagination'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { useRevokeAllSessions } from '../model/use-revoke-all-sessions'
import { useUserSessions } from '../model/use-user-sessions'

import { SessionDeviceCell, useSessionDeviceLabel } from './SessionDeviceCell'
import { SessionRowMenu } from './SessionRowMenu'

interface UserSessionsCardProps {
  userId: string
  targetEmail: string
  /** The viewer's own detail page — the destructive controls are replaced by a note pointing to Settings instead. */
  isSelf: boolean
}

const emptySessions: AdminSession[] = []

function timeCell(
  format: ReturnType<typeof useFormatter>,
  iso: string | null,
  notAvailable: string
) {
  return iso ? <ConsoleTimestamp value={iso} /> : notAvailable
}

/**
 * Client-side interactive leaf on the otherwise server-rendered User Detail
 * page (ADR-079's direct-backend-transport split is for Server Components;
 * this is the one interactive leaf that owns its own TanStack Query state
 * instead). Active sessions only, one row per logical session family.
 */
export function UserSessionsCard({ userId, targetEmail, isSelf }: UserSessionsCardProps) {
  const t = useTranslations('console')
  const tSessions = useTranslations('sessions')
  const tCommon = useTranslations('common')
  const format = useFormatter()
  const { data, isPending, isFetching, isError, refetch, page, setPage, pageSize } =
    useUserSessions(userId)
  const [revokeAllOpen, setRevokeAllOpen] = useState(false)
  const { confirm, isSubmitting, stepUp, isSteppingUp, submitStepUp, closeStepUp } =
    useRevokeAllSessions(userId)

  const refreshButton = useRef<HTMLButtonElement>(null)
  const previousIds = useRef<string[]>([])
  const previousTotal = useRef(0)
  const restoreFocus = useRef(false)
  const total = data?.total ?? 0
  const rows = data?.data ?? emptySessions
  useEffect(() => {
    const ids = rows.map((row) => row.sessionId)
    const rowRemoved =
      total < previousTotal.current && previousIds.current.some((id) => !ids.includes(id))
    previousIds.current = ids
    previousTotal.current = total
    // A deleted row's focused trigger leaves focus on body. Preserve any
    // focus the operator deliberately moved elsewhere while the request ran.
    if (rowRemoved && document.activeElement === document.body) restoreFocus.current = true
    if (restoreFocus.current && !isFetching) {
      if (document.activeElement === document.body) refreshButton.current?.focus()
      restoreFocus.current = false
    }
  }, [rows, total, isFetching])
  const hasAnyLocation = rows.some((row) => row.location !== null)

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle as="h2" className="text-xl">
          {t('userSessionsHeading', { count: total })}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            ref={refreshButton}
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            {t('userSessionsRefresh')}
          </Button>
          {!isSelf && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isSubmitting || total === 0}
              onClick={() => setRevokeAllOpen(true)}
            >
              {t('userSessionsRevokeAll')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isSelf && (
          <p className="text-sm text-muted-foreground">
            {t.rich('userSessionsSelfNote', {
              link: (chunks) =>
                ADMIN_CONSOLE_CONFIG.mode === 'path' ? (
                  <RouteProgressLink href="/settings/sessions" className="underline">
                    {chunks}
                  </RouteProgressLink>
                ) : (
                  chunks
                ),
            })}
          </p>
        )}

        {isError ? (
          <PrimaryUnavailableFallback reason="network" onRetry={() => void refetch()} />
        ) : isPending ? (
          <DetailRelationRowsSkeleton />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-muted-foreground">
            {t('userSessionsEmpty')}
          </p>
        ) : (
          <>
            <div
              aria-busy={isFetching}
              className="hidden rounded-lg border border-border bg-surface-elevated shadow-md sm:block"
            >
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[34%]">{tSessions('device')}</TableHead>
                    <TableHead className="w-[22%]">{t('userSessionsLastAuthenticated')}</TableHead>
                    <TableHead className="w-[22%]">{t('userSessionsLatestTokenIssued')}</TableHead>
                    <TableHead className="w-[22%]">{t('userSessionsExpires')}</TableHead>
                    {!isSelf && (
                      <TableHead className="w-10">
                        <span className="sr-only">{tSessions('actions')}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <SessionTableRow
                      key={row.sessionId}
                      userId={userId}
                      row={row}
                      format={format}
                      targetEmail={targetEmail}
                      isSelf={isSelf}
                      notAvailable={tCommon('notAvailable')}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul aria-busy={isFetching} className="space-y-3 sm:hidden">
              {rows.map((row) => (
                <SessionMobileCard
                  key={row.sessionId}
                  userId={userId}
                  row={row}
                  format={format}
                  targetEmail={targetEmail}
                  isSelf={isSelf}
                  notAvailable={tCommon('notAvailable')}
                />
              ))}
            </ul>

            {hasAnyLocation && (
              <p className="text-xs text-muted-foreground">
                {tSessions.rich('locationAttribution', {
                  link: (chunks) => (
                    <a
                      href="https://db-ip.com"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            )}

            <PaginationButtons
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              previousLabel={tSessions('previous')}
              nextLabel={tSessions('next')}
              isFetching={isFetching}
            />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={revokeAllOpen}
        onOpenChange={setRevokeAllOpen}
        title={t('userSessionsRevokeAllConfirmTitle')}
        description={t('userSessionsRevokeAllConfirmDescription', { email: targetEmail })}
        confirmLabel={t('userSessionsRevokeAll')}
        cancelLabel={tCommon('cancel')}
        variant="destructive"
        disabled={isSubmitting}
        onConfirm={() => void confirm()}
      />
      <ConsoleStepUpDialog
        phase={stepUp}
        isSubmitting={isSteppingUp}
        onSubmit={submitStepUp}
        onClose={closeStepUp}
      />
    </Card>
  )
}

interface RowProps {
  userId: string
  row: AdminSession
  format: ReturnType<typeof useFormatter>
  targetEmail: string
  isSelf: boolean
  notAvailable: string
}

function SessionTableRow({ userId, row, format, targetEmail, isSelf, notAvailable }: RowProps) {
  const { label } = useSessionDeviceLabel(row.userAgent)
  return (
    <TableRow>
      <TableCell>
        <SessionDeviceCell session={row} />
      </TableCell>
      <TableCell>{timeCell(format, row.lastAuthAt, notAvailable)}</TableCell>
      <TableCell>{timeCell(format, row.createdAt, notAvailable)}</TableCell>
      <TableCell>{timeCell(format, row.expiresAt, notAvailable)}</TableCell>
      {!isSelf && (
        <TableCell>
          <SessionRowMenu
            userId={userId}
            sessionId={row.sessionId}
            deviceLabel={label}
            targetEmail={targetEmail}
          />
        </TableCell>
      )}
    </TableRow>
  )
}

function SessionMobileCard({ userId, row, format, targetEmail, isSelf, notAvailable }: RowProps) {
  const t = useTranslations('console')
  const { label } = useSessionDeviceLabel(row.userAgent)
  return (
    <li className="space-y-2 rounded-lg border border-border bg-surface-elevated p-4">
      <div className="flex items-start justify-between gap-2">
        <SessionDeviceCell session={row} />
        {!isSelf && (
          <SessionRowMenu
            userId={userId}
            sessionId={row.sessionId}
            deviceLabel={label}
            targetEmail={targetEmail}
          />
        )}
      </div>
      <dl className="grid grid-cols-1 gap-2 text-xs text-muted-foreground min-[420px]:grid-cols-2">
        <div>
          <dt>{t('userSessionsLastAuthenticated')}</dt>
          <dd className="text-foreground">{timeCell(format, row.lastAuthAt, notAvailable)}</dd>
        </div>
        <div>
          <dt>{t('userSessionsLatestTokenIssued')}</dt>
          <dd className="text-foreground">{timeCell(format, row.createdAt, notAvailable)}</dd>
        </div>
        <div>
          <dt>{t('userSessionsExpires')}</dt>
          <dd className="text-foreground">{timeCell(format, row.expiresAt, notAvailable)}</dd>
        </div>
      </dl>
    </li>
  )
}
