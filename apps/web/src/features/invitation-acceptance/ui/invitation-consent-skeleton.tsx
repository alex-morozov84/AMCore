import { Skeleton } from '@/shared/ui/skeleton'

export function InvitationConsentSkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <div className="space-y-4 rounded-lg border bg-card p-4">
          {[0, 1, 2].map((id) => (
            <div key={id} className="space-y-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="h-4 w-4/5" />
    </section>
  )
}
