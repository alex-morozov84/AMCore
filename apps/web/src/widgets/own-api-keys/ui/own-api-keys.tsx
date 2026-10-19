'use client'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import type { ApiKeyListItemResponse, ApiKeyQuery } from '@amcore/shared'

import {
  KeyPermissions,
  KeyStatus,
  type OwnApiKeyController,
  OwnKeyOrganizationPicker,
  useOwnApiKeys,
} from '@/entities/api-key'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { DataTableSurface } from '@/shared/ui/data-table-surface'
import { DebouncedSearchField } from '@/shared/ui/debounced-search-field'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Disclosure } from '@/shared/ui/disclosure'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'
import { FilterButtons } from '@/shared/ui/filter-buttons'
import { FilterPanel } from '@/shared/ui/filter-panel'
import { PaginationButtons } from '@/shared/ui/pagination'
import { RowActionsMenu } from '@/shared/ui/row-actions-menu'
import { Skeleton } from '@/shared/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Timestamp } from '@/shared/ui/timestamp'
import { toast } from '@/shared/ui/toast'

type RevokeTarget = { id: string; name?: string; organizationName?: string | null }

export function OwnApiKeys({
  controller,
  disabled,
  query: criteria,
  invalidQuery,
  onQueryChange,
}: {
  controller: OwnApiKeyController
  disabled: boolean
  query: ApiKeyQuery
  invalidQuery: boolean
  onQueryChange: (query: ApiKeyQuery, reason?: 'criteria' | 'page') => void
}) {
  const t = useTranslations('ownApiKeys')
  const memberText = useTranslations('memberApiKeys')
  const id = useId()
  const heading = useRef<HTMLDivElement>(null)
  const commandTrigger = useRef<HTMLElement | null>(null)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const query = useOwnApiKeys(controller, criteria, !invalidQuery)
  const [detailId, setDetailId] = useState<string>()
  const detail = query.data?.data.find((key) => key.id === detailId)
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget>()
  const revocation = useSyncExternalStore(
    controller.subscribe,
    controller.getRevocationSnapshot,
    controller.getRevocationSnapshot
  )
  const receipt = revocation.phase === 'idle' ? undefined : revocation.phase
  const error = revocation.error
  const [confirm, setConfirm] = useState(false)
  const corrected = useRef(false)
  const criteriaIdentity = JSON.stringify([
    criteria.search,
    criteria.status,
    criteria.organizationId,
    criteria.organizationAvailability,
  ])
  useEffect(() => {
    corrected.current = false
  }, [criteriaIdentity])
  useEffect(() => {
    if (
      !query.data ||
      criteria.page <= Math.max(1, Math.ceil(query.data.total / 20)) ||
      corrected.current
    )
      return
    corrected.current = true
    onQueryChange({ ...criteria, page: Math.max(1, Math.ceil(query.data.total / 20)) })
  }, [query.data, criteria, onQueryChange])
  const detailViewIdentity = `${criteriaIdentity}:${criteria.page}`
  const [detailView, setDetailView] = useState(detailViewIdentity)
  if (detailView !== detailViewIdentity) {
    setDetailView(detailViewIdentity)
    setDetailId(undefined)
  }
  const change = (next: Partial<ApiKeyQuery>) => onQueryChange({ ...criteria, ...next, page: 1 })
  const askRevoke = (key: ApiKeyListItemResponse) => {
    commandTrigger.current =
      document.getElementById(`${id}-actions-${key.id}`) ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setRevokeTarget(key)
    setConfirm(true)
  }
  const revoke = async () => {
    if (!revokeTarget) return
    try {
      if (await controller.revoke(revokeTarget.id, revokeTarget)) {
        toast.add({ type: 'success', title: t('revokeSuccess') })
        setDetailId(undefined)
        await query.refetch()
      }
    } catch {
      /* Entity retains the typed outcome for this binding/key. */
    }
  }
  return (
    <section className="space-y-4" ref={heading} tabIndex={-1}>
      <FilterPanel>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <DebouncedSearchField
              identity={JSON.stringify([
                controller.admission.binding,
                criteria.status,
                criteria.organizationId,
                criteria.organizationAvailability,
              ])}
              search={criteria.search ?? ''}
              page={criteria.page}
              onCommit={(search) => change({ search: search || undefined })}
              id={id}
              label={t('search')}
              placeholder={t('search')}
              clearLabel={t('clearSearch')}
              maxLength={100}
            />
          </div>
          <OwnKeyOrganizationPicker
            className="w-full min-w-0 sm:max-w-none"
            controller={controller}
            purpose="inventory"
            selectedId={criteria.organizationId}
            unavailable={Boolean(criteria.organizationAvailability)}
            onSelect={(option, unavailable) =>
              change({
                organizationId: option?.id,
                organizationAvailability: unavailable ? 'unavailable' : undefined,
              })
            }
          />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <FilterButtons
              label={t('filter')}
              value={criteria.status}
              options={(['all', 'unexpired', 'expired', 'revoked'] as const).map((value) => ({
                value,
                label: t(value),
              }))}
              onChange={(status) => change({ status })}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onQueryChange({ page: 1, limit: 20, status: 'all' })}
            >
              {t('reset')}
            </Button>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t('refresh')}
            </Button>
          </div>
        </div>
      </FilterPanel>
      {invalidQuery ? (
        <p role="alert">{t('invalidQuery')}</p>
      ) : (
        <>
          {query.isError && <ApiErrorAlert error={query.error} />}
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {query.data
              ? t('total', { count: query.data.total })
              : query.isPending
                ? t('loading')
                : ''}
          </p>
          <DataTableSurface role="region" aria-label={t('inventory')} tabIndex={0}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {(
                    ['name', 'organizationColumn', 'statusColumn', 'expires', 'actions'] as const
                  ).map((key) => (
                    <TableHead key={key}>{t(key)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isPending
                  ? [1, 2, 3, 4, 5].map((row) => (
                      <TableRow key={row} aria-busy="true">
                        {[1, 2, 3, 4, 5].map((cell) => (
                          <TableCell key={cell}>
                            <Skeleton className="h-8 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : query.data?.data.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell className="max-w-64 whitespace-normal">
                          <Button
                            variant="link"
                            className="h-auto justify-start p-0 text-left whitespace-normal break-words"
                            onClick={() => {
                              detailTrigger.current =
                                document.activeElement instanceof HTMLElement
                                  ? document.activeElement
                                  : null
                              setDetailId(key.id)
                            }}
                          >
                            {key.name}
                          </Button>
                        </TableCell>
                        <TableCell className="max-w-56 whitespace-normal break-words">
                          {key.organizationName ?? t('organizationUnavailable')}
                        </TableCell>
                        <TableCell>
                          <KeyStatus status={key.status} />
                        </TableCell>
                        <TableCell>
                          {key.expiresAt ? <Timestamp value={key.expiresAt} /> : t('noExpiry')}
                        </TableCell>
                        <TableCell>
                          {!key.revokedAt && (
                            <RowActionsMenu
                              triggerId={`${id}-actions-${key.id}`}
                              label={t('rowActions', { name: key.name })}
                              disabled={disabled || receipt === 'pending'}
                            >
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => askRevoke(key)}
                              >
                                {t('revoke')}
                              </DropdownMenuItem>
                            </RowActionsMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </DataTableSurface>
          {query.data && !query.data.data.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {t(
                    query.data.total
                      ? 'outOfRange'
                      : criteria.search ||
                          criteria.organizationId ||
                          criteria.organizationAvailability ||
                          criteria.status !== 'all'
                        ? 'noMatches'
                        : 'empty'
                  )}
                </EmptyTitle>
              </EmptyHeader>
              {criteria.page > 1 && (
                <Button variant="outline" onClick={() => onQueryChange({ ...criteria, page: 1 })}>
                  {t('firstPage')}
                </Button>
              )}
            </Empty>
          )}
          {query.data && (
            <PaginationButtons
              page={criteria.page}
              pageSize={20}
              total={query.data.total}
              isFetching={query.isFetching}
              onPageChange={(page) => onQueryChange({ ...criteria, page }, 'page')}
              previousLabel={t('previous')}
              nextLabel={t('next')}
            />
          )}
        </>
      )}
      {receipt && receipt !== 'confirmed' && (
        <div role="status" className="space-y-2">
          <p>
            {t(
              receipt === 'pending'
                ? 'revokePending'
                : receipt === 'refused'
                  ? revocation.refusal === 'verification'
                    ? 'sessionCheckFailed'
                    : 'revokeRefused'
                  : 'revokeUnknown'
            )}
          </p>
          {error !== undefined && <ApiErrorAlert error={error} />}
          {receipt === 'unknown' && (
            <>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t('refresh')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (!revocation.keyId) return
                  commandTrigger.current =
                    document.activeElement instanceof HTMLElement ? document.activeElement : null
                  setRevokeTarget({
                    id: revocation.keyId,
                    name: revocation.name,
                    organizationName: revocation.organizationName,
                  })
                  setConfirm(true)
                }}
              >
                {t('revokeAgain')}
              </Button>
            </>
          )}
        </div>
      )}
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetailId(undefined)
        }}
      >
        <DialogContent
          finalFocus={() =>
            detailTrigger.current?.isConnected ? detailTrigger.current : (heading.current ?? false)
          }
          closeLabel={t('close')}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <>
              <p>{detail.organizationName ?? t('organizationUnavailable')}</p>
              <KeyStatus status={detail.status} />
              <dl className="space-y-2">
                {[
                  ['created', detail.createdAt],
                  ['expires', detail.expiresAt],
                  ['lastUsed', detail.lastUsedAt],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{t(label as 'created')}</dt>
                    <dd>
                      {value ? (
                        <Timestamp value={value} variant="inline" />
                      ) : label === 'expires' ? (
                        t('noExpiry')
                      ) : (
                        t('notRecorded')
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <h3 className="font-medium">{t('permissions')}</h3>
              <KeyPermissions scopes={detail.scopes} />
              {detail.revocationReason && <p>{memberText(detail.revocationReason)}</p>}
              <Disclosure label={t('technicalDetails')}>
                <ul>
                  {detail.scopes.map((scope, index) => (
                    <li key={`${scope}:${index}`}>{scope}</li>
                  ))}
                </ul>
                <p className="break-all">
                  {t('keyId')}: {detail.id}
                </p>
                <p className="break-all">
                  {t('organizationId')}: {detail.organizationId}
                </p>
              </Disclosure>
              {!detail.revokedAt && (
                <Button variant="outline" onClick={() => askRevoke(detail)}>
                  {t('revoke')}
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        finalFocus={() =>
          commandTrigger.current?.isConnected ? commandTrigger.current : (heading.current ?? false)
        }
        open={confirm}
        onOpenChange={setConfirm}
        title={t('revokeTitle')}
        description={
          revokeTarget?.name
            ? t('revokeDescription', {
                name: t('namedPair', {
                  name: revokeTarget.name,
                  other: revokeTarget.organizationName ?? t('organizationUnavailable'),
                }),
              })
            : t('revokeIdDescription', { id: revokeTarget?.id ?? '' })
        }
        confirmLabel={t('revoke')}
        cancelLabel={t('cancel')}
        variant="destructive"
        onConfirm={() => void revoke()}
      />
    </section>
  )
}
