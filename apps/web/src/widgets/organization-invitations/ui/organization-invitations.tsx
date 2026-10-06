'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { InviteListItem, InviteListQuery } from '@amcore/shared'

import {
  type OrganizationAccessController,
  type OrganizationContextState,
  useInvitationManagerOperations,
  useOrganizationInvitations,
} from '@/entities/organization-context'
import { type InvitationDraftMode, InvitationForm } from '@/features/invitation-management'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { DebouncedSearchField } from '@/shared/ui/debounced-search-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { FilterPanel } from '@/shared/ui/filter-panel'
import { ListPagination } from '@/shared/ui/list-pagination'

import { InvitationListSkeleton } from './invitation-list-skeleton'
import { InvitationTable } from './invitation-table'
import { InvitationOperationStatus } from './operation-status'

type View = Pick<InviteListQuery, 'search' | 'page' | 'status'>
export function OrganizationInvitations({
  controller,
  authorityStatus,
  query: controlled,
  onQueryChange,
}: {
  controller: OrganizationAccessController
  authorityStatus: OrganizationContextState['status']
  query?: View
  onQueryChange?(query: View, reason: 'search' | 'status' | 'page'): void
}) {
  const t = useTranslations('organizationInvitations')
  const [local, setLocal] = useState<View>({ page: 1, search: '', status: 'pending' })
  const query = controlled ?? local
  const change = useCallback(
    (next: View, reason: 'search' | 'status' | 'page') =>
      onQueryChange ? onQueryChange(next, reason) : setLocal(next),
    [onQueryChange]
  )
  const list = useOrganizationInvitations(controller, { ...query, limit: 20 })
  const operation = useInvitationManagerOperations(controller)
  const [editor, setEditor] = useState<{ mode: InvitationDraftMode; initial?: InviteListItem }>()
  const [revoking, setRevoking] = useState<InviteListItem>()
  const trigger = useRef<HTMLElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const inviteButton = useRef<HTMLButtonElement>(null)
  const denied = !['ready', 'pending'].includes(authorityStatus)
  const settled = operation.status === 'committed' && operation.followup === 'ready'
  const disabled = !list.available || (operation.status !== 'idle' && !settled)
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 20))
  const focusNextPage = useRef(false)
  const recoveredPage = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!list.ready || list.pending || list.error || !list.data) return
    if (query.page > pages) {
      const identity = JSON.stringify([controller.binding, controller.organizationId, query, pages])
      if (recoveredPage.current === identity) return
      recoveredPage.current = identity
      let cancelled = false
      // Repair URL/local pagination after this refreshed result commits; never apply an old view after navigation.
      queueMicrotask(() => {
        if (!cancelled) change({ ...query, page: pages }, 'page')
      })
      return () => {
        cancelled = true
      }
    }
    recoveredPage.current = undefined
    if (focusNextPage.current) {
      focusNextPage.current = false
      heading.current?.focus()
    }
  }, [list.ready, list.pending, list.error, list.data, query, pages, change, controller])
  function returnFocus() {
    const original = trigger.current
    const current = original?.isConnected
      ? original
      : original?.id
        ? document.getElementById(original.id)
        : null
    return current && !current.hasAttribute('disabled') ? current : heading.current
  }
  function close() {
    setEditor(undefined)
    setRevoking(undefined)
  }
  function action(row: InviteListItem, kind: 'repeat' | 'replace' | 'revoke', source: HTMLElement) {
    if (disabled) return
    trigger.current = source
    if (kind === 'revoke') setRevoking(row)
    else setEditor({ mode: kind, initial: row })
  }
  const readable = list.available && !denied
  const currentRevoke = readable
    ? list.data?.data.find((row) => row.id === revoking?.id)
    : undefined
  const staleRevoke = Boolean(
    revoking && readable && (!currentRevoke || currentRevoke.generation !== revoking.generation)
  )
  return (
    <div
      ref={heading}
      role="region"
      aria-label={t('title')}
      tabIndex={-1}
      className="space-y-4 outline-none"
    >
      <InvitationOperationStatus operation={operation} />
      <FilterPanel>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
            <DebouncedSearchField
              identity={`${controller.binding}:${controller.organizationId}:${query.status}`}
              search={query.search ?? ''}
              page={query.page}
              onCommit={(search) => change({ ...query, search, page: 1 }, 'search')}
              id="organization-invitation-search"
              label={t('search')}
              placeholder={t('searchPlaceholder')}
              clearLabel={t('clear')}
              maxLength={254}
              disabled={denied}
            />
          </div>
          <Button
            ref={inviteButton}
            disabled={disabled}
            onClick={(event) => {
              trigger.current = event.currentTarget
              setEditor({ mode: 'create' })
            }}
          >
            {t('invite')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('filters')}>
          {(['pending', 'expired', 'all'] as const).map((status) => (
            <Button
              key={status}
              variant={query.status === status ? 'default' : 'outline'}
              disabled={denied}
              aria-pressed={query.status === status}
              onClick={() => change({ ...query, status, page: 1 }, 'status')}
            >
              {t(status)}
            </Button>
          ))}
        </div>
      </FilterPanel>
      {denied ? (
        <p role="status">{t('denied')}</p>
      ) : list.error ? (
        <div className="space-y-3">
          <ApiErrorAlert error={list.error} />
          <Button
            variant="outline"
            disabled={list.retryAt !== undefined}
            onClick={() => {
              void list.refresh().catch(() => undefined)
            }}
          >
            {t('retry')}
          </Button>
        </div>
      ) : !readable ? (
        <InvitationListSkeleton />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {t('count', { count: list.data?.total ?? 0 })}
          </p>
          {list.data?.data.length ? (
            <InvitationTable rows={list.data.data} disabled={disabled} onAction={action} />
          ) : (
            <div className="rounded-xl border bg-card p-6" role="status">
              <p>{t(query.search || query.status !== 'pending' ? 'noMatches' : 'empty')}</p>
              {(query.search || query.status !== 'pending') && (
                <Button
                  variant="outline"
                  onClick={() => change({ page: 1, search: '', status: 'pending' }, 'status')}
                >
                  {t('resetFilters')}
                </Button>
              )}
            </div>
          )}
          <ListPagination
            status={t('page', { page: query.page, pages })}
            previous={
              query.page > 1 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    focusNextPage.current = true
                    change({ ...query, page: query.page - 1 }, 'page')
                  }}
                >
                  {t('previous')}
                </Button>
              )
            }
            next={
              query.page < pages && (
                <Button
                  variant="outline"
                  onClick={() => {
                    focusNextPage.current = true
                    change({ ...query, page: query.page + 1 }, 'page')
                  }}
                >
                  {t('next')}
                </Button>
              )
            }
          />
        </>
      )}
      {!denied && (
        <Dialog
          open={Boolean(editor)}
          onOpenChange={(open) => {
            if (!open) close()
          }}
        >
          <DialogContent
            finalFocus={returnFocus}
            showCloseButton={false}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
          >
            <DialogHeader>
              <DialogTitle>
                {t(
                  editor?.mode === 'create'
                    ? 'inviteTitle'
                    : editor?.mode === 'replace'
                      ? 'replaceTitle'
                      : 'repeatTitle'
                )}
              </DialogTitle>
              <DialogDescription>
                {t(editor?.mode === 'create' ? 'inviteHelp' : 'reissueHelp')}
              </DialogDescription>
            </DialogHeader>
            {editor && (
              <InvitationForm
                key={`${editor.mode}:${editor.initial?.id ?? 'new'}`}
                access={controller}
                operations={operation.controller}
                mode={editor.mode}
                initial={editor.initial}
                current={
                  readable
                    ? list.data?.data.find((row) => row.id === editor.initial?.id)
                    : undefined
                }
                disabled={disabled}
                masked={!readable}
                onClose={close}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        finalFocus={returnFocus}
        open={Boolean(revoking) && !denied}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={t('revokeTitle')}
        description={t(!readable ? 'checking' : staleRevoke ? 'generationChanged' : 'revokeHelp')}
        confirmLabel={t('revoke')}
        cancelLabel={t('cancel')}
        variant="destructive"
        disabled={disabled || staleRevoke}
        onConfirm={() => {
          const row = revoking
          close()
          if (row)
            void operation.controller.submit({
              kind: 'revoke',
              inviteId: row.id,
              input: { expectedGeneration: row.generation },
            })
        }}
      />
    </div>
  )
}
