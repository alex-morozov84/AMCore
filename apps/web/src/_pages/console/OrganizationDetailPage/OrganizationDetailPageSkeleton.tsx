import { DetailResultsSkeleton } from '@/shared/ui/console-detail/DetailResultsSkeleton'
import { Skeleton } from '@/shared/ui/skeleton'

export function OrganizationDetailPageSkeleton() {
  return (
    <section aria-busy="true" className="space-y-5">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="h-9 w-56" />
      <DetailResultsSkeleton searchable />
    </section>
  )
}
