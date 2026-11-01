import { ConsolePageFrame } from '@/_pages/console'
import {
  OrganizationDetailPage,
  OrganizationDetailPageSkeleton,
} from '@/_pages/console/OrganizationDetailPage'
import { parseDetailPage, parseDetailSearch } from '@/shared/lib/console-detail-url'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'
import { parseConsoleReturnHref } from '@/shared/lib/console-public-href'

interface OrganizationDetailRouteProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    page?: string | string[]
    search?: string | string[]
    returnTo?: string | string[]
  }>
}

export default async function OrganizationDetailRoute({
  params,
  searchParams,
}: OrganizationDetailRouteProps) {
  requireConsoleEnabled()
  const [{ id }, query] = await Promise.all([params, searchParams])
  return (
    <ConsolePageFrame fallback={<OrganizationDetailPageSkeleton />}>
      <OrganizationDetailPage
        id={id}
        page={parseDetailPage(query.page)}
        search={parseDetailSearch(query.search)}
        returnTo={parseConsoleReturnHref(query.returnTo)}
      />
    </ConsolePageFrame>
  )
}
