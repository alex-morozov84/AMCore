import { Skeleton } from '@/shared/ui/skeleton'

import { OrganizationsResultsSkeleton } from './OrganizationsResultsSkeleton'

/**
 * Cold/first-load fallback only — `ConsolePageFrame`'s outer `<Suspense>`
 * around the whole `OrganizationsPage`. Every later search/sort/page
 * navigation re-suspends only `OrganizationsResults` (heading and search
 * box render immediately and stay mounted — see `OrganizationsPage.tsx`),
 * which uses `OrganizationsResultsSkeleton` alone. Keep both in sync with
 * the real markup whenever the Organizations panel's UI changes — see
 * `docs/operations-console/development.md`'s "Add a functional panel"
 * guidance.
 */
export function OrganizationsPageSkeleton() {
  return (
    <section className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-9 w-44" />
      <Skeleton className="h-9 w-full" />
      <OrganizationsResultsSkeleton />
    </section>
  )
}
