import { InvitationConsentSkeleton } from '@/features/invitation-acceptance'
import { Skeleton } from '@/shared/ui/skeleton'

export function RecipientSkeleton({ kind, label }: { kind: 'auth' | 'consent'; label: string }) {
  if (kind === 'consent') return <InvitationConsentSkeleton label={label} />
  return <section aria-busy="true" aria-label={label} className="space-y-6">
    <div className="space-y-2"><Skeleton className="h-8 w-4/5" /><Skeleton className="h-5 w-full" /></div>
    <div className="space-y-3">{[0, 1, 2].map(id => <Skeleton key={id} className="h-9 w-full" />)}</div>
    <Skeleton className="h-10 w-full" />
    <div className="space-y-4">{[0, 1].map(id => <div key={id} className="space-y-2">
      <Skeleton className="h-4 w-20" /><Skeleton className="h-9 w-full" />
    </div>)}<Skeleton className="h-9 w-full" /></div>
    <Skeleton className="h-9 w-24" />
  </section>
}
