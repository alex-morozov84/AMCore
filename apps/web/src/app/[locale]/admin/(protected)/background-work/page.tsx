import { ConsolePageFrame } from '@/_pages/console'
import { BackgroundWorkPage, BackgroundWorkPageSkeleton } from '@/_pages/console/BackgroundWorkPage'

export default async function BackgroundWorkRoute() {
  return (
    <ConsolePageFrame fallback={<BackgroundWorkPageSkeleton />}>
      <BackgroundWorkPage />
    </ConsolePageFrame>
  )
}
