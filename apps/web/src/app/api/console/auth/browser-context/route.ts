import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { handleBrowserBootstrap } from '@/shared/api/bff/browser-bootstrap-handler'
import { consoleBrowserContext } from '@/shared/api/console/browser-context'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, async () => {
    try {
      return await handleBrowserBootstrap(request, consoleBrowserContext(request))
    } catch (error) {
      return authFailureResponse(request, error)
    }
  })
}
