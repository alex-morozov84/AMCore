import { handleEstablishmentSession } from '@/shared/api/console/organization-establishment'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleEstablishmentSession(request))
}
const denied = () => new Response(null, { status: 405, headers: { Allow: 'GET' } })
export const HEAD = denied
export const OPTIONS = denied
export const POST = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
