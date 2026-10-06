import { setRequestLocale } from 'next-intl/server'

import { InvitationRecipientMount } from '@/_app/invitation-flow/index.server'
import { resolveLocaleParam } from '@/i18n/params'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

export default async function Invitation({ params }: { params: Promise<{ locale: string; flowId: string }> }) {
  const [locale, { flowId }] = await Promise.all([resolveLocaleParam(params), params])
  setRequestLocale(locale)
  return <InvitationRecipientMount flowId={flowId} />
}
