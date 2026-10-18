import { provisioningRoot } from '@/shared/api/console/organization-provisioning'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

async function handle(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => provisioningRoot(request))
}
export const GET = handle
export const POST = handle
const denied = () => new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
export const HEAD = denied
export const OPTIONS = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
