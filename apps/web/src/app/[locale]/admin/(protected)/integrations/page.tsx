import { ConsolePageFrame } from '@/_pages/console'
import { IntegrationsPage, IntegrationsPageSkeleton } from '@/_pages/console/IntegrationsPage'

export default function IntegrationsRoute() {
  return (
    <ConsolePageFrame fallback={<IntegrationsPageSkeleton />}>
      <IntegrationsPage />
    </ConsolePageFrame>
  )
}
