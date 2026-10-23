import { ConsolePageFrame } from '@/_pages/console'
import { ScheduledJobsPage, ScheduledJobsPageSkeleton } from '@/_pages/console/ScheduledJobsPage'

export default function ScheduledJobsRoute() {
  return (
    <ConsolePageFrame fallback={<ScheduledJobsPageSkeleton />}>
      <ScheduledJobsPage />
    </ConsolePageFrame>
  )
}
