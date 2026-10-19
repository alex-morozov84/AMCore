import { getTranslations } from 'next-intl/server'
import type { ApiKeyQuery, OwnApiKeyAdmission } from '@amcore/shared'

import { PageTitle } from '@/shared/ui/page-title'
import { OwnApiKeysHost } from '@/widgets/own-api-keys'

export async function OwnApiKeysPage({
  admission,
  query,
  invalidQuery,
  baseHref,
}: {
  admission: OwnApiKeyAdmission
  query: ApiKeyQuery
  invalidQuery: boolean
  baseHref: string
}) {
  const t = await getTranslations('ownApiKeys')
  return (
    <section className="space-y-6">
      <PageTitle>{t('title')}</PageTitle>
      <p className="text-muted-foreground">{t('intro')}</p>

      <OwnApiKeysHost
        key={admission.binding}
        admission={admission}
        query={query}
        invalidQuery={invalidQuery}
        baseHref={baseHref}
      />
    </section>
  )
}
