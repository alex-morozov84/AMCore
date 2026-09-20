import { PAGINATION } from '@amcore/shared'

import { OrganizationsPage } from '@/_pages/console'

interface OrganizationsRouteProps {
  searchParams: Promise<{ page?: string | string[] }>
}

/** Fails closed to the default page on missing/malformed input, never NaN through to the fetch. */
function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = value ? Number.parseInt(value, 10) : NaN
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : PAGINATION.DEFAULT_PAGE
}

export default async function OrganizationsRoute({ searchParams }: OrganizationsRouteProps) {
  const { page: rawPage } = await searchParams
  return <OrganizationsPage page={parsePage(rawPage)} limit={PAGINATION.DEFAULT_LIMIT} />
}
