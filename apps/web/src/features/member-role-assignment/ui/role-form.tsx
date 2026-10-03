'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { MemberRolesResponse } from '@amcore/shared'

import type { OrganizationAccessController } from '@/entities/organization-context'
import { useMemberRoleAssignments } from '@/entities/organization-context'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { DialogFooter } from '@/shared/ui/dialog'
import { PaginationButtons } from '@/shared/ui/pagination'

import { useRoleDraft } from '../model/use-role-draft'

import { MemberSearch } from './member-search'
import { RoleChoices } from './role-choices'

export function MemberRoleForm({
  controller,
  userId,
  initial,
  isSelf,
  onClose,
}: {
  controller: OrganizationAccessController
  userId: string
  initial: MemberRolesResponse
  isSelf: boolean
  onClose?: () => void
}) {
  const t = useTranslations('organizationMembers')
  const [query, setQuery] = useState({
    page: 1,
    search: '',
    section: initial.editMode === 'editable' ? ('available' as const) : ('assigned' as const),
  })
  const roles = useMemberRoleAssignments(controller, { userId, ...query })
  const draft = useRoleDraft(initial, roles, controller, onClose)
  const readOnly = draft.snapshot.editMode !== 'editable'
  const disabled = roles.busy || !roles.ready || draft.reviewing
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => void draft.form.handleSubmit(draft.submit)(event)}
    >
      <ApiErrorAlert error={draft.error} />
      {draft.notice && (
        <Alert>
          <AlertDescription role="status">{t(draft.notice)}</AlertDescription>
        </Alert>
      )}
      {draft.outdated && !draft.notice && (
        <Alert>
          <AlertDescription>{t('rolesChanged')}</AlertDescription>
        </Alert>
      )}
      {readOnly && (
        <Alert>
          <AlertDescription>
            {t(draft.snapshot.editMode === 'oversized' ? 'oversized' : 'byteOversized')}
          </AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">
        {t('selected', {
          count: readOnly ? draft.snapshot.assignedRoleCount : draft.selected.length,
        })}
      </p>
      <MemberSearch
        identity={JSON.stringify([
          controller.binding,
          controller.organizationId,
          userId,
          draft.snapshot.member.memberId,
          query.section,
        ])}
        id="member-role-search"
        search={query.search}
        page={query.page}
        onCommit={(search) => setQuery((q) => ({ ...q, search, page: 1 }))}
      />
      <div className="flex gap-2" role="group" aria-label={t('roleFilters')}>
        {(['available', 'assigned'] as const).map((section) => (
          <Button
            key={section}
            type="button"
            aria-pressed={query.section === section}
            variant={query.section === section ? 'secondary' : 'outline'}
            disabled={disabled || (readOnly && section === 'available')}
            onClick={() => setQuery((q) => ({ ...q, section, page: 1 }))}
          >
            {t(section === 'available' ? 'allRoles' : 'assigned')}
          </Button>
        ))}
      </div>
      <RoleChoices
        pending={roles.pending}
        unavailable={!roles.ready}
        error={roles.error}
        onRetry={() => void controller.refresh().catch(() => undefined)}
        retryDisabled={roles.busy || roles.retryAt !== undefined}
        roles={roles.data?.choices.data ?? []}
        selected={draft.selected}
        disabled={disabled || draft.needsReview}
        readOnly={readOnly}
        onChange={(ids) => {
          draft.form.setValue('roleIds', ids, { shouldDirty: true })
          draft.setAck(false)
        }}
      />
      <div className="min-h-8">
        <PaginationButtons
          page={query.page}
          pageSize={20}
          total={roles.data?.choices.total ?? 0}
          onPageChange={(page) => setQuery((q) => ({ ...q, page }))}
          previousLabel={t('previous')}
          nextLabel={t('next')}
          isFetching={roles.pending || disabled}
        />
      </div>
      {!readOnly && draft.selected.length === 0 && <p>{t('zero')}</p>}
      {!readOnly && isSelf && draft.changed && (
        <label className="flex gap-2 text-sm">
          <Checkbox
            checked={draft.ack}
            onCheckedChange={(v) => draft.setAck(v === true)}
            disabled={disabled}
          />
          {t('selfWarning')}
        </label>
      )}
      {draft.needsReview && (
        <Button
          type="button"
          variant="outline"
          disabled={
            roles.busy ||
            draft.reviewing ||
            draft.retryAt !== undefined ||
            roles.retryAt !== undefined
          }
          onClick={() => void draft.review()}
        >
          {t('reviewCurrent')}
        </Button>
      )}
      <DialogFooter>
        {onClose && (
          <Button type="button" variant="outline" disabled={roles.busy} onClick={onClose}>
            {t('cancel')}
          </Button>
        )}
        {!readOnly && (
          <Button
            type="submit"
            disabled={
              disabled ||
              roles.pending ||
              Boolean(roles.error) ||
              draft.needsReview ||
              draft.retryAt !== undefined ||
              !draft.changed ||
              (isSelf && !draft.ack) ||
              draft.selected.length > 1000
            }
          >
            {roles.busy ? t('saving') : t('save')}
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}
