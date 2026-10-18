import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  type OrganizationAccessController,
  useMemberApiKeys,
} from '@/entities/organization-context'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { FilterButtons } from '@/shared/ui/filter-buttons'
import { PaginationButtons } from '@/shared/ui/pagination'
import { toast } from '@/shared/ui/toast'

import { MemberKeyListView } from './member-key-list'
import { type MemberKeyNotice, MemberKeyResult } from './member-key-result'
import { MemberKeySkeleton } from './member-key-skeleton'

type Status = 'all' | 'unexpired' | 'expired' | 'revoked'
export interface MemberKeyTarget {
  userId: string
  memberId: string
  name?: string | null
  email?: string
  organizationName?: string
}
export function MemberApiKeysDialog({
  controller,
  target,
  open,
  onClose,
  notice,
  onNotice,
}: {
  controller: OrganizationAccessController
  target: MemberKeyTarget
  open: boolean
  onClose: () => void
  notice?: MemberKeyNotice
  onNotice: (value: MemberKeyNotice) => void
}) {
  const t = useTranslations('memberApiKeys')
  const heading = useRef<HTMLHeadingElement>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<Status>('all')
  const [confirm, setConfirm] = useState<{ id?: string; name?: string }>()
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const keys = useMemberApiKeys(controller, target.userId, {
    expectedMemberId: target.memberId,
    page,
    limit: 20,
    status,
  })
  const data = keys.error || !keys.ready ? undefined : keys.data
  const unavailable = keys.busy || keys.pending || !data || (notice?.kind === 'unknown' && !checked)
  const check = async () => {
    setChecking(true)
    try {
      await keys.refresh()
      setChecked(true)
    } catch {
      setChecked(false)
    } finally {
      setChecking(false)
    }
  }
  const submit = async () => {
    const captured = confirm
    setConfirm(undefined)
    if (!captured) return
    setChecked(false)
    const outcome = await keys.revoke(captured.id)
    if (outcome.status === 'retired' || outcome.status === 'busy') return
    if (outcome.status === 'committed') {
      onNotice({
        kind: 'committed',
        count: outcome.result.affectedCount,
        refreshFailed: outcome.followup !== 'ready',
      })
      toast.add({ type: 'success', title: t('result', { count: outcome.result.affectedCount }) })
    } else if (outcome.status === 'unknown' || outcome.status === 'rejected')
      onNotice({ kind: outcome.status, error: outcome.error })
    heading.current?.focus()
  }
  return (
    <>
      <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-2xl"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle ref={heading} tabIndex={-1}>
              {t('title')}
            </DialogTitle>
            <DialogDescription>
              {data
                ? t('identity', {
                    organization: data.organization.name,
                    name: data.member.name ?? data.member.email,
                    email: data.member.email,
                  })
                : keys.ready && target.email
                  ? t('identity', {
                      organization: target.organizationName ?? t('selectedOrganization'),
                      name: target.name ?? target.email,
                      email: target.email,
                    })
                  : t('description')}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto [scrollbar-gutter:stable] px-4">
            <p className="text-sm text-muted-foreground">{t('explanation')}</p>
            {notice && (
              <MemberKeyResult
                notice={notice}
                onCheck={() => void check()}
                busy={checking || keys.busy || keys.retryAt !== undefined}
              />
            )}
            <ApiErrorAlert error={keys.error} />
            <FilterButtons
              label={t('filter')}
              value={status}
              options={(['all', 'unexpired', 'expired', 'revoked'] as const).map((value) => ({
                value,
                label: t(value),
              }))}
              onChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
            />
            {keys.pending && <MemberKeySkeleton />}
            {!keys.ready && <p role="status">{t('unavailable')}</p>}
            {data && !keys.pending && (
              <>
                <p>{t('counts', { total: data.total, count: data.revocableCount })}</p>
                <Button
                  variant="outline"
                  disabled={
                    Boolean(unavailable) || data.revocableCount === 0 || data.revocableCount > 1000
                  }
                  onClick={() => setConfirm({})}
                >
                  {t('revokeAll')}
                </Button>
                {data.revocableCount > 1000 && <p role="status">{t('limit')}</p>}
                <MemberKeyListView
                  data={data}
                  status={status}
                  busy={Boolean(unavailable)}
                  onRevoke={(id, name) => setConfirm({ id, name })}
                />
              </>
            )}
            {Boolean(keys.error) && (
              <Button
                variant="outline"
                disabled={keys.retryAt !== undefined || keys.busy}
                onClick={() => void check()}
              >
                {t('retry')}
              </Button>
            )}
          </div>
          <DialogFooter className="shrink-0 flex-row items-center justify-between">
            <div className="min-h-9 min-w-0 flex-1">
              {keys.ready && (
                <PaginationButtons
                  page={page}
                  onPageChange={setPage}
                  hasPreviousPage={page > 1}
                  hasNextPage={Boolean(data && page * 20 < data.total)}
                  previousLabel={t('previous')}
                  nextLabel={t('next')}
                  isFetching={keys.pending || keys.busy || Boolean(keys.error)}
                />
              )}
            </div>
            <Button variant="outline" onClick={onClose}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={open && confirm !== undefined}
        onOpenChange={(value) => !value && setConfirm(undefined)}
        title={t(confirm?.id ? 'confirmOne' : 'confirmAll')}
        description={
          <span className="block space-y-2">
            <span className="block break-all">
              {data?.organization.name} · {data?.member.email} {confirm?.name}
            </span>
            <span className="block">{t(confirm?.id ? 'irreversible' : 'allWarning')}</span>
          </span>
        }
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        variant="destructive"
        disabled={keys.busy}
        finalFocus={heading}
        onConfirm={() => void submit()}
      />
    </>
  )
}
