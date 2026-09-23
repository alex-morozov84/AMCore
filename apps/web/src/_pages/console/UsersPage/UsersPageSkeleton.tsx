import { Skeleton } from '@/shared/ui/skeleton'

import { UsersResultsSkeleton } from './UsersResultsSkeleton'

/**
 * Cold/first-load fallback only — `ConsolePageFrame`'s outer `<Suspense>`
 * around the whole `UsersPage`. Every later search/sort/page navigation
 * re-suspends only `UsersResults` (heading and search box now render
 * immediately and stay mounted — see `UsersPage.tsx`), which uses
 * `UsersResultsSkeleton` alone. Keep both in sync with the real markup
 * whenever the Users panel's UI changes — see
 * `docs/operations-console/development.md`'s "Add a functional panel" §.
 */
export function UsersPageSkeleton() {
  return (
    <section className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-9 w-full" />
      <UsersResultsSkeleton />
    </section>
  )
}
