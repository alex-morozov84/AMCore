import { probeConsoleAccess } from '@/shared/api/console/access-probe'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(request: Request): Promise<Response> {
  return withConsoleHostGuard(
    request,
    async () => new Response(null, { status: await probeConsoleAccess() })
  )
}
