import { getTranslations } from 'next-intl/server'
import { adminApiKeyQuerySchema } from '@amcore/shared'

import { ConsolePageFrame } from '@/_pages/console'
import { ApiKeysPage, ApiKeysPageSkeleton } from '@/_pages/console/ApiKeysPage'

export default async function ApiKeysRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''))
  const query = adminApiKeyQuerySchema.safeParse(cleaned)
  const t = await getTranslations('console.apiKeys')
  return (
    <ConsolePageFrame fallback={<ApiKeysPageSkeleton />}>
      {query.success ? (
        <ApiKeysPage query={query.data} />
      ) : (
        <p role="alert">{t('invalidFilters')}</p>
      )}
    </ConsolePageFrame>
  )
}
