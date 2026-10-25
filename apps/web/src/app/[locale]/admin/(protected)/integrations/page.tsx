import { ConsolePageFrame } from '@/_pages/console'
import { IntegrationsPage, IntegrationsPageSkeleton } from '@/_pages/console/IntegrationsPage'

export default async function IntegrationsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sourceParams = await searchParams
  return (
    <ConsolePageFrame fallback={<IntegrationsPageSkeleton />}>
      <IntegrationsPage sourceParams={sourceParams} />
    </ConsolePageFrame>
  )
}
