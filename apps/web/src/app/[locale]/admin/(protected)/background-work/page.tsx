import { ConsolePageFrame } from '@/_pages/console'
import { BackgroundWorkPage, BackgroundWorkPageSkeleton } from '@/_pages/console/BackgroundWorkPage'

/** `?board=unavailable` is the only marker: a page load of the queue board that could not be shown. */
export default async function BackgroundWorkRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const boardOpenFailed = query.board === 'unavailable'
  return (
    <ConsolePageFrame fallback={<BackgroundWorkPageSkeleton />}>
      <BackgroundWorkPage boardOpenFailed={boardOpenFailed} sourceParams={query} />
    </ConsolePageFrame>
  )
}
