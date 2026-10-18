import { useTranslations } from 'next-intl'

import { Skeleton } from '@/shared/ui/skeleton'

/** The loading shape follows key cards; the dialog keeps its viewport throughout reads. */
export function MemberKeySkeleton() {
  const t = useTranslations('memberApiKeys')
  return (
    <div aria-busy="true" role="status" className="space-y-4">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-5 w-2/3 motion-reduce:animate-none" />
      <Skeleton className="h-9 w-36 motion-reduce:animate-none" />
      {[0, 1].map((key) => (
        <div key={key} aria-hidden="true" className="space-y-3 rounded-xl border p-6">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-5 w-1/2 motion-reduce:animate-none" />
            <Skeleton className="h-6 w-24 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
          <Skeleton className="h-9 w-28 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}
