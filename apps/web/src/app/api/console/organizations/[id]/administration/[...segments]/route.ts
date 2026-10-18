import { administratorOrganization } from '@/shared/api/console/organization-administration'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

async function handle(request: Request, context: { params: Promise<{ id: string; segments?: string[] }> }) {
  const params = await context.params
  return withConsoleHostGuard(request, () => administratorOrganization(request, params.id, params.segments))
}
export const GET = handle
export const POST = handle
const denied = () => new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
export const HEAD = denied
export const OPTIONS = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
