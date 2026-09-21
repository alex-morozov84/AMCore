import { PAGINATION } from '@amcore/shared'

import { ConsolePageFrame, UsersPage, UsersPageSkeleton } from '@/_pages/console'

interface UsersRouteProps {
  searchParams: Promise<{ page?: string | string[] }>
}

function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return PAGINATION.DEFAULT_PAGE
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : PAGINATION.DEFAULT_PAGE
}

export default async function UsersRoute({ searchParams }: UsersRouteProps) {
  const { page: rawPage } = await searchParams
  return (
    <ConsolePageFrame fallback={<UsersPageSkeleton />}>
      <UsersPage page={parsePage(rawPage)} limit={PAGINATION.DEFAULT_LIMIT} />
    </ConsolePageFrame>
  )
}
