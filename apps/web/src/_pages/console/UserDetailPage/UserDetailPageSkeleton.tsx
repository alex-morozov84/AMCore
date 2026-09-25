import { DetailResultsSkeleton } from '@/shared/ui/console-detail/DetailResultsSkeleton'
import { Skeleton } from '@/shared/ui/skeleton'

export function UserDetailPageSkeleton() {
  return (
    <section aria-busy="true" className="space-y-5">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-9 w-48" />
      <DetailResultsSkeleton searchable />
    </section>
  )
}
