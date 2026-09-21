import { ConsolePageFrame, OverviewPage, OverviewPageSkeleton } from '@/_pages/console'

export default async function AdminPage() {
  return (
    <ConsolePageFrame fallback={<OverviewPageSkeleton />}>
      <OverviewPage />
    </ConsolePageFrame>
  )
}
