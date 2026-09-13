import { handleConsoleLogout } from '@/shared/api/console/logout-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleLogout(request))
}
