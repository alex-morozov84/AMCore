import { administratorAttention } from '@/shared/api/console/organization-administration'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export const GET = (request: Request) => withConsoleHostGuard(request, () => administratorAttention(request))
const denied = () => new Response(null, { status: 405, headers: { Allow: 'GET' } })
export const POST = denied
export const HEAD = denied
export const OPTIONS = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
