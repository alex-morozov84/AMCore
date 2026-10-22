import { setRequestLocale } from 'next-intl/server'

import {
  adminInvitationPlacement,
  InvitationUnusableMount,
} from '@/_app/invitation-flow/index.server'
import { resolveLocaleParam } from '@/i18n/params'
import { noindexMetadata } from '@/shared/lib/seo/page-metadata'

export const metadata = noindexMetadata

export default async function Unusable({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ reason?: string | string[] }>
}) {
  const [locale, query] = await Promise.all([resolveLocaleParam(params), searchParams])
  setRequestLocale(locale)
  return (
    <InvitationUnusableMount
      unavailable={query.reason === 'unavailable'}
      placement={adminInvitationPlacement}
    />
  )
}
