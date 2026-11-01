import { ConsolePageFrame, OverviewPage, OverviewPageSkeleton } from '@/_pages/console'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'

export default async function AdminPage() {
  requireConsoleEnabled()
  return (
    <ConsolePageFrame fallback={<OverviewPageSkeleton />}>
      <OverviewPage />
    </ConsolePageFrame>
  )
}
