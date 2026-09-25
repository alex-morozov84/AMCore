'use client'

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import { detailPageHref } from '@/shared/lib/console-detail-url'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { useDebouncedDraft } from '@/shared/lib/use-debounced-draft'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { SearchField } from '@/shared/ui/search-field'

import { DetailRelationRowsSkeleton } from './DetailResultsSkeleton'

const PendingNavigation = createContext<(href: string) => void>(() => {})

interface Props {
  base: string
  page: number
  search?: string
  returnTo?: string
  inputId: string
  label: string
  placeholder: string
  clearLabel: string
  children: ReactNode
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
  children,
}: Props) {
  const router = useRouteProgressRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const authoritativeHref = detailPageHref(base, page, returnTo, search)
  const pending = pendingHref !== null && pendingHref !== authoritativeHref
  useEffect(() => {
    if (!pending) return
    const timeout = window.setTimeout(() => setPendingHref(null), 10_000)
    return () => window.clearTimeout(timeout)
  }, [pending, pendingHref])
  const target = useCallback(
    (value: string) => detailPageHref(base, 1, returnTo, value || undefined),
    [base, returnTo]
  )
  const onCommit = useCallback(
    (value: string) => {
      const href = target(value)
      setPendingHref(href)
      router.replace(href, { scroll: false })
    },
    [router, target]
  )
  const { value, setValue, commitNow } = useDebouncedDraft({
    authoritativeValue: search ?? '',
    authoritativeIdentity: authoritativeHref,
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
    <PendingNavigation.Provider value={setPendingHref}>
      <div className="space-y-4">
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
        {pending ? <DetailRelationRowsSkeleton /> : children}
      </div>
    </PendingNavigation.Provider>
  )
}

export function DetailRelationNavigationLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const markPending = useContext(PendingNavigation)
  return (
    <RouteProgressLink
      prefetch={false}
      href={href}
      onNavigate={() => markPending(href)}
      className={className}
    >
      {children}
    </RouteProgressLink>
  )
}
