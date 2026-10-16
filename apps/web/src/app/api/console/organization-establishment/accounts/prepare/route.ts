import { establishmentConsoleHandlers } from '@/shared/api/console/organization-establishment'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => establishmentConsoleHandlers.prepare(request))
}
const denied = () => new Response(null, { status: 405, headers: { Allow: 'POST' } })
export const GET = denied
export const HEAD = denied
export const OPTIONS = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
