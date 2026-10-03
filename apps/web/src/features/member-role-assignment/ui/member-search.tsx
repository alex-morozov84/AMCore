'use client'
import { useTranslations } from 'next-intl'

import { useDebouncedDraft } from '@/shared/lib/use-debounced-draft'
import { SearchField } from '@/shared/ui/search-field'

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
  onCommit: (value: string) => void
  id: string
  placeholder?: string
}) {
  const t = useTranslations('organizationMembers')
  const draft = useDebouncedDraft({
    authoritativeValue: search,
    authoritativeIdentity: JSON.stringify([identity, search, page]),
    getCommitIdentity: (value) => JSON.stringify([identity, value, 1]),
    delayMs: 300,
    normalize: (value) => value.trim(),
    onCommit,
  })
  return (
    <div role="search">
      <SearchField
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            draft.commitNow(draft.value)
          }
        }}
        id={id}
        name="search"
        value={draft.value}
        onValueChange={draft.setValue}
        onClear={() => {
          draft.setValue('')
          draft.commitNow('')
        }}
        label={t('search')}
        placeholder={placeholder ?? t('search')}
        clearLabel={t('clear')}
        maxLength={100}
      />
    </div>
  )
}
