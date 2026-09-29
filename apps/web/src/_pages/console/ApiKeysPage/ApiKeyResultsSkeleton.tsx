import { Skeleton } from '@/shared/ui/skeleton'

export function ApiKeyResultsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="flex justify-between gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-5 w-64" />
      <div className="hidden rounded-lg border border-border p-4 md:block">
        <Skeleton className="mb-4 h-7 w-full" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="my-3 h-16 w-full" />
        ))}
      </div>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-56 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-6 w-full" />
    </div>
  )
}
