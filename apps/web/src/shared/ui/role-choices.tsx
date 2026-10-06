'use client'

import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { RoleChecklist } from '@/shared/ui/role-checklist'
import { Skeleton } from '@/shared/ui/skeleton'

type Props = React.ComponentProps<typeof RoleChecklist> & {
  pending: boolean
  error?: unknown
  unavailable?: boolean
  onRetry: () => void
  retryDisabled?: boolean
  regionLabels: { roleList: string; loading: string; retry: string; unavailable: string }
}
export function RoleChoices({
  pending,
  error,
  unavailable,
  onRetry,
  retryDisabled,
  regionLabels,
  ...props
}: Props) {
  return (
    <div
      className="h-64 overflow-y-auto sm:h-[min(25rem,45dvh)]"
      role="region"
      aria-label={regionLabels.roleList}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A scrolling region needs keyboard access even while its children are loading or read-only.
      tabIndex={0}
      aria-busy={pending}
    >
      {pending ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">{regionLabels.loading}</span>
          {[0, 1, 2].map((key) => (
            <div key={key} aria-hidden="true" className="flex gap-3 rounded-lg border p-3">
              <Skeleton className="size-4 shrink-0 motion-reduce:animate-none" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-1/2 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-full motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </div>
      ) : error || unavailable ? (
        <div className="space-y-3">
          {error ? (
            <ApiErrorAlert error={error} />
          ) : (
            <p role="status">{regionLabels.unavailable}</p>
          )}
          <Button type="button" variant="outline" disabled={retryDisabled} onClick={onRetry}>
            {regionLabels.retry}
          </Button>
        </div>
      ) : (
        <RoleChecklist {...props} />
      )}
    </div>
  )
}
