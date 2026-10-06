'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { InviteListItem } from '@amcore/shared'

import type { InvitationManagerOperations, OrganizationAccessController } from '@/entities/organization-context'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { DebouncedSearchField } from '@/shared/ui/debounced-search-field'
import { DialogFooter } from '@/shared/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PaginationButtons } from '@/shared/ui/pagination'
import { RoleBadges } from '@/shared/ui/role-badges'
import { RoleChoices } from '@/shared/ui/role-choices'
import { Skeleton } from '@/shared/ui/skeleton'

import { type InvitationDraftMode, useInvitationDraft } from '../model/use-invitation-draft'

export function InvitationForm({ access, operations, mode, initial, current, disabled, masked = false, onClose }: {
  access: OrganizationAccessController; operations: InvitationManagerOperations; mode: InvitationDraftMode;
  initial?: InviteListItem; current?: InviteListItem; disabled: boolean; masked?: boolean; onClose(): void
}) {
  const t = useTranslations('organizationInvitations')
  const draft = useInvitationDraft(access, operations, mode, initial)
  const [confirmed, setConfirmed] = useState(false)
  const outdated = Boolean(draft.snapshot && (!current || current.generation !== draft.snapshot.generation))
  const roleUnavailable = draft.roles.pending || !draft.roles.ready || Boolean(draft.roles.error) || !draft.roles.data
  const blocked = disabled || outdated || (mode === 'repeat' ? !draft.snapshot?.intentValid : roleUnavailable)
  if (draft.initializing) return <div className="space-y-4" aria-busy="true">
    <span role="status" className="sr-only">{t('loading')}</span>
    <Skeleton className="h-8 motion-reduce:animate-none" />
    <Skeleton className="h-8 motion-reduce:animate-none" />
    <Skeleton className="h-64 motion-reduce:animate-none" />
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button></DialogFooter>
  </div>
  if (masked) return <div className="space-y-4" role="status"><p>{t('checking')}</p><Button variant="outline" onClick={onClose}>{t('close')}</Button></div>
  return <Form {...draft.form}>
    <form className="space-y-4" onSubmit={draft.form.handleSubmit(async values => {
      const outcome = await draft.submit(values)
      if (outcome?.status === 'committed') onClose()
    })}>
      <FormField control={draft.form.control} name="email" render={({ field }) => <FormItem>
        <FormLabel>{t('email')}</FormLabel><FormControl><Input {...field} type="email" readOnly={mode !== 'create'} disabled={disabled} autoComplete="off" /></FormControl><FormMessage />
      </FormItem>} />
      {outdated && <div className="space-y-2" role="status"><p>{t('generationChanged')}</p>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => { if (current) { draft.review(current); setConfirmed(false) } }}>{t('reviewCurrent')}</Button></div>}
      {mode === 'repeat' ? <div className="space-y-2"><p className="text-sm">{t('repeatHelp')}</p>
        <RoleBadges roles={draft.snapshot?.roles.map(role => ({ id: role.requestedRoleId, name: role.name ?? role.nameAtIssue, description: role.id === null ? t('deletedRole') : role.description })) ?? []} empty={t('emptyRoles')} missingDescription={t('noDescription')} />
      </div> : <>
        <p className="text-sm text-muted-foreground">{t('rolesHelp')}</p>
        <p className="text-sm">{t('selected', { count: draft.selected.length })}</p>
        <div className="flex flex-wrap gap-2">{draft.selected.map(id => <Button key={id} type="button" size="sm" variant="outline" disabled={disabled}
          onClick={() => draft.form.setValue('roleIds', draft.selected.filter(value => value !== id), { shouldDirty: true, shouldValidate: true })}
          aria-label={t('removeRole', { role: draft.names[id] ?? id })}>{draft.names[id] ?? id}</Button>)}</div>
        <DebouncedSearchField identity={`${access.binding}:${access.organizationId}:roles`} search={draft.query.search} page={draft.query.page}
          onCommit={search => draft.setQuery(q => ({ ...q, search, page: 1 }))} id="invitation-role-search" label={t('roleSearch')}
          placeholder={t('roleSearch')} clearLabel={t('clear')} maxLength={100} disabled={disabled} />
        <RoleChoices roles={draft.roles.data?.data ?? []} selected={draft.selected} onChange={ids => draft.form.setValue('roleIds', ids, { shouldDirty: true, shouldValidate: true })}
          disabled={disabled} readOnly={false} maxSelected={20} pending={draft.roles.pending} error={draft.roles.error} unavailable={!draft.roles.ready}
          onRetry={() => { void draft.roles.refresh().catch(() => undefined) }} retryDisabled={disabled || draft.roles.retryAt !== undefined}
          labels={{ system: t('system'), custom: t('custom'), noDescription: t('noDescription'), empty: t('emptyRoles') }}
          regionLabels={{ roleList: t('roleList'), loading: t('loading'), retry: t('retry'), unavailable: t('rolesUnavailable') }} />
        <PaginationButtons page={draft.query.page} pageSize={20} total={draft.roles.data?.total ?? 0} previousLabel={t('previous')} nextLabel={t('next')}
          onPageChange={page => draft.setQuery(q => ({ ...q, page }))} isFetching={disabled || draft.roles.pending} />
        {draft.form.formState.errors.roleIds && <p role="alert" className="text-sm text-destructive">{draft.form.formState.errors.roleIds.message}</p>}
      </>}
      {mode !== 'create' && <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} disabled={disabled} onCheckedChange={value => setConfirmed(Boolean(value))} />{t('reissueConfirmation')}</label>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button type="submit" disabled={blocked || (mode !== 'create' && !confirmed)}>{t(mode === 'create' ? 'invite' : 'resend')}</Button>
      </DialogFooter>
    </form>
  </Form>
}
