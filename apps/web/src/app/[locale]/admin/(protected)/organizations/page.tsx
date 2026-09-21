import { PAGINATION } from '@amcore/shared'

import { ConsolePageFrame, OrganizationsPage, OrganizationsPageSkeleton } from '@/_pages/console'

interface OrganizationsRouteProps {
  searchParams: Promise<{ page?: string | string[] }>
}

/** Fails closed to the default page on missing/malformed input, never NaN through to the fetch. */
function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return PAGINATION.DEFAULT_PAGE
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : PAGINATION.DEFAULT_PAGE
}

export default async function OrganizationsRoute({ searchParams }: OrganizationsRouteProps) {
  const { page: rawPage } = await searchParams
  return (
    <ConsolePageFrame fallback={<OrganizationsPageSkeleton />}>
      <OrganizationsPage page={parsePage(rawPage)} limit={PAGINATION.DEFAULT_LIMIT} />
    </ConsolePageFrame>
  )
}
