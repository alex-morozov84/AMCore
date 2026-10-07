'use client'

import { useTranslations } from 'next-intl'

import { DebouncedSearchField } from '@/shared/ui/debounced-search-field'

export function MemberSearch({
  identity,
  search,
  page,
  onCommit,
  id,
  placeholder,
}: {
  identity: string
  search: string
  page: number
  onCommit(value: string): void
  id: string
  placeholder?: string
}) {
  const t = useTranslations('organizationMembers')
  return (
    <DebouncedSearchField
      identity={identity}
      search={search}
      page={page}
      onCommit={onCommit}
      id={id}
      label={t('search')}
      placeholder={placeholder ?? t('search')}
      clearLabel={t('clear')}
      maxLength={100}
    />
  )
}
