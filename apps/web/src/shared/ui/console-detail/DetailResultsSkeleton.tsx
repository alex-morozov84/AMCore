import { Card, CardContent, CardHeader } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

const ROWS = [0, 1, 2]

/** Same summary card and related-list geometry used by both detail pages. */
export function DetailResultsSkeleton({ searchable = false }: { searchable?: boolean }) {
  return (
    <div aria-busy="true" className="space-y-5">
      <Card>
        <CardHeader>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROWS.map((row) => (
            <div key={row} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </CardContent>
      </Card>
      <section className="space-y-4">
        <Skeleton className="h-6 w-44" />
        {searchable && <Skeleton className="h-9 w-full" />}
        <div className="hidden rounded-lg border border-border p-4 sm:block">
          <Skeleton className="mb-4 h-5 w-full" />
          {ROWS.map((row) => (
            <Skeleton key={row} className="my-3 h-10 w-full" />
          ))}
        </div>
        <div className="space-y-3 sm:hidden">
          {ROWS.map((row) => (
            <div key={row} className="space-y-2 rounded-lg border border-border p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
