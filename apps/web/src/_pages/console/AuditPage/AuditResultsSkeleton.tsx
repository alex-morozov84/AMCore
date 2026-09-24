import { Skeleton } from '@/shared/ui/skeleton'

export function AuditResultsSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="space-y-3 rounded-lg border border-border bg-surface-elevated p-4 shadow-md"
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-72 max-w-full" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div
          key={row}
          className="grid grid-cols-1 gap-3 border-t border-border py-2 lg:grid-cols-5"
        >
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      ))}
    </div>
  )
}
