'use client'
import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { OwnKeyOrganizationOption } from '@amcore/shared'

import { useDebouncedDraft } from '@/shared/lib/use-debounced-draft'
import { cn } from '@/shared/lib/utils'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/shared/ui/combobox'
import { PaginationButtons } from '@/shared/ui/pagination'

import { useOwnKeyOrganizations } from '../model/hooks'
import type { OwnApiKeyController } from '../model/own-api-key-controller'

export function OwnKeyOrganizationPicker({
  controller,
  purpose,
  selectedId,
  unavailable,
  onSelect,
  disabled,
  className,
}: {
  controller: OwnApiKeyController
  purpose: 'inventory' | 'creation'
  selectedId?: string
  unavailable?: boolean
  onSelect: (option: OwnKeyOrganizationOption | null, unavailable?: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const t = useTranslations('ownApiKeys')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = useOwnKeyOrganizations(controller, {
    purpose,
    search,
    page,
    limit: 20,
    ...(selectedId && { selectedId }),
  })
  const [saved, setSaved] = useState<{ identity: string; option: OwnKeyOrganizationOption | null }>(
    { identity: '', option: null }
  )
  const selectionIdentity = `${controller.admission.binding}:${purpose}:${selectedId ?? ''}`
  if (query.data && (saved.identity !== selectionIdentity || saved.option !== query.data.selected))
    setSaved({ identity: selectionIdentity, option: query.data.selected })
  const selected =
    query.data?.selected ?? (saved.identity === selectionIdentity ? saved.option : null)
  const label = unavailable
    ? t('organizationUnavailable')
    : selected
      ? t('namedPair', { name: selected.name, other: selected.slug })
      : selectedId
        ? t(query.isPending ? 'loading' : 'organizationUnavailable')
        : t(purpose === 'inventory' ? 'allOrganizations' : 'selectOrganization')
  const draft = useDebouncedDraft({
    authoritativeValue: search,
    authoritativeIdentity: JSON.stringify([controller.admission.binding, purpose, search, page]),
    getCommitIdentity: (value) => JSON.stringify([controller.admission.binding, purpose, value, 1]),
    delayMs: 300,
    normalize: (value) => value.trim(),
    onCommit: (value) => {
      setSearch(value)
      setPage(1)
    },
  })
  const options = [
    ...(purpose === 'inventory'
      ? [{ value: '__all', label: t('allOrganizations'), disabled: false }]
      : []),
    ...(purpose === 'inventory' && query.data?.hasUnavailable
      ? [{ value: '__unavailable', label: t('organizationUnavailable'), disabled: false }]
      : []),
    ...(query.data?.data.map((option) => ({
      value: option.id,
      label: t('namedPair', { name: option.name, other: option.slug }),
      disabled:
        purpose === 'creation' && 'canManageTeamAccess' in option && !option.canManageTeamAccess,
    })) ?? []),
  ]
  return (
    <Combobox
      items={options.map((option) => option.value)}
      itemToStringLabel={(value) =>
        options.find((option) => option.value === value)?.label ?? label
      }
      filter={null}
      open={open}
      onOpenChange={setOpen}
      value={
        unavailable ? '__unavailable' : (selectedId ?? (purpose === 'inventory' ? '__all' : null))
      }
      inputValue={draft.value}
      onInputValueChange={(value, details) => {
        if (details.reason === 'input-change') draft.setValue(value)
      }}
      onValueChange={(value) => {
        if (!value) return
        if (value === '__all') onSelect(null)
        else if (value === '__unavailable') onSelect(null, true)
        else {
          const option = query.data?.data.find((option) => option.id === value)
          if (option) onSelect(option)
        }
        setOpen(false)
      }}
    >
      <ComboboxTrigger
        disabled={disabled}
        className={cn('max-w-full sm:max-w-80', className)}
        aria-label={label}
      >
        {label}
      </ComboboxTrigger>
      <ComboboxContent aria-label={t('selectOrganization')}>
        <ComboboxInput
          id={id}
          aria-label={t('organizationSearch')}
          placeholder={t('organizationSearch')}
          maxLength={100}
        />
        {query.isPending && (
          <p role="status" aria-busy="true">
            {t('loading')}
          </p>
        )}
        {query.isError && (
          <>
            <ApiErrorAlert error={query.error} />
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('refresh')}
            </Button>
          </>
        )}
        <ComboboxList className="min-h-0 overflow-y-auto">
          {options.map((option) => (
            <ComboboxItem key={option.value} value={option.value} disabled={option.disabled}>
              <span className="min-w-0 break-words">
                {option.label}
                {option.disabled && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t('creationDenied')}
                  </span>
                )}
              </span>
            </ComboboxItem>
          ))}
        </ComboboxList>
        {query.data && !query.data.data.length && (
          <p>{t(search ? 'noOrganizationsMatch' : 'noOrganizations')}</p>
        )}
        {query.data && (
          <PaginationButtons
            page={page}
            pageSize={20}
            total={query.data.total}
            onPageChange={setPage}
            previousLabel={t('previous')}
            nextLabel={t('next')}
            isFetching={query.isFetching}
          />
        )}
      </ComboboxContent>
    </Combobox>
  )
}
