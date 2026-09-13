import { handleConsoleLogin } from '@/shared/api/console/auth-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleLogin(request))
}
