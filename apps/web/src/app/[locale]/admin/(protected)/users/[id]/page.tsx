import { ConsolePageFrame } from '@/_pages/console'
import { UserDetailPage, UserDetailPageSkeleton } from '@/_pages/console/UserDetailPage'
import { parseDetailPage, parseDetailSearch } from '@/shared/lib/console-detail-url'
import { parseConsoleReturnHref } from '@/shared/lib/console-public-href'

interface UserDetailRouteProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    page?: string | string[]
    search?: string | string[]
    returnTo?: string | string[]
  }>
}

export default async function UserDetailRoute({ params, searchParams }: UserDetailRouteProps) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  return (
    <ConsolePageFrame fallback={<UserDetailPageSkeleton />}>
      <UserDetailPage
        id={id}
        page={parseDetailPage(query.page)}
        search={parseDetailSearch(query.search)}
        returnTo={parseConsoleReturnHref(query.returnTo)}
      />
    </ConsolePageFrame>
  )
}
