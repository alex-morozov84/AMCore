'use client'

import { type FormEvent, useCallback } from 'react'

import { detailPageHref } from '@/shared/lib/console-detail-url'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { useDebouncedDraft } from '@/shared/lib/use-debounced-draft'
import { SearchField } from '@/shared/ui/search-field'

interface Props {
  base: string
  page: number
  search?: string
  returnTo?: string
  inputId: string
  label: string
  placeholder: string
  clearLabel: string
}

/** The same 300 ms, replace-navigation search behavior as Console inventories. */
export function DetailRelationSearch({
  base,
  page,
  search,
  returnTo,
  inputId,
  label,
  placeholder,
  clearLabel,
}: Props) {
  const router = useRouteProgressRouter()
  const target = useCallback(
    (value: string) => detailPageHref(base, 1, returnTo, value || undefined),
    [base, returnTo]
  )
  const onCommit = useCallback(
    (value: string) => router.replace(target(value), { scroll: false }),
    [router, target]
  )
  const { value, setValue, commitNow } = useDebouncedDraft({
    authoritativeValue: search ?? '',
    authoritativeIdentity: detailPageHref(base, page, returnTo, search),
    getCommitIdentity: target,
    delayMs: 300,
    normalize: (draft) => draft.trim(),
    onCommit,
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    commitNow(value)
  }
  function clear() {
    setValue('')
    commitNow('')
  }
  return (
    <form role="search" method="GET" action={base} onSubmit={submit} className="flex">
      <SearchField
        id={inputId}
        name="search"
        value={value}
        onValueChange={setValue}
        onClear={clear}
        label={label}
        placeholder={placeholder}
        clearLabel={clearLabel}
        maxLength={255}
      />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
    </form>
  )
}
