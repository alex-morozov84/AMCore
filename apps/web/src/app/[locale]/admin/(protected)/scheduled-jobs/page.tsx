import { ConsolePageFrame } from '@/_pages/console'
import { ScheduledJobsPage, ScheduledJobsPageSkeleton } from '@/_pages/console/ScheduledJobsPage'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'

export default async function ScheduledJobsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  requireConsoleEnabled()
  const sourceParams = await searchParams
  return (
    <ConsolePageFrame fallback={<ScheduledJobsPageSkeleton />}>
      <ScheduledJobsPage sourceParams={sourceParams} />
    </ConsolePageFrame>
  )
}
