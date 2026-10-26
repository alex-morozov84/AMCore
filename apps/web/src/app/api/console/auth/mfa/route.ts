import { handleConsoleMfa } from '@/shared/api/console/mfa-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export function GET(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleMfa(request))
}
export const POST = GET
