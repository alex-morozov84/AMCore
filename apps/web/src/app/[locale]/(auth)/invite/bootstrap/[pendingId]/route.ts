import { invitationHandlers } from '@/_app/invitation-flow/index.server'
import { resolveLocaleParam } from '@/i18n/params'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; pendingId: string }> }
) {
  const [locale, { pendingId }] = await Promise.all([resolveLocaleParam(params), params])
  return invitationHandlers.bootstrap(request, locale, pendingId)
}
