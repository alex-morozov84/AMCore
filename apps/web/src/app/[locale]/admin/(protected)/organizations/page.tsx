import { PAGINATION } from '@amcore/shared'

import { OrganizationsPage } from '@/_pages/console'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'

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
  await requireSuperAdmin()
  const { page: rawPage } = await searchParams
  return <OrganizationsPage page={parsePage(rawPage)} limit={PAGINATION.DEFAULT_LIMIT} />
}
