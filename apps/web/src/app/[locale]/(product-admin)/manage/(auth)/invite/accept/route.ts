import { invitationHandlers } from '@/_app/invitation-flow/index.server'
import { resolveLocaleParam } from '@/i18n/params'

export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  return invitationHandlers.adminIngress(request, await resolveLocaleParam(params))
}
