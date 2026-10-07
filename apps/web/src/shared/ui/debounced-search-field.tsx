'use client'

import { useDebouncedDraft } from '@/shared/lib/use-debounced-draft'
import { SearchField } from '@/shared/ui/search-field'

/** Shared interaction; each feature supplies URL policy, identity, limits and localized labels. */
export function DebouncedSearchField({
  identity,
  search,
  page,
  onCommit,
  id,
  label,
  placeholder,
  clearLabel,
  maxLength,
  disabled = false,
}: {
  identity: string
  search: string
  page: number
  onCommit(value: string): void
  id: string
  label: string
  placeholder: string
  clearLabel: string
  maxLength: number
  disabled?: boolean
}) {
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
        id={id}
        name="search"
        value={draft.value}
        onValueChange={draft.setValue}
        label={label}
        placeholder={placeholder}
        clearLabel={clearLabel}
        maxLength={maxLength}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            draft.commitNow(draft.value)
          }
        }}
        onClear={() => {
          draft.setValue('')
          draft.commitNow('')
        }}
      />
    </div>
  )
}
