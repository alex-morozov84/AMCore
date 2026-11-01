import { ConsolePageFrame } from '@/_pages/console'
import { IntegrationsPage, IntegrationsPageSkeleton } from '@/_pages/console/IntegrationsPage'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'

export default async function IntegrationsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  requireConsoleEnabled()
  const sourceParams = await searchParams
  return (
    <ConsolePageFrame fallback={<IntegrationsPageSkeleton />}>
      <IntegrationsPage sourceParams={sourceParams} />
    </ConsolePageFrame>
  )
}
