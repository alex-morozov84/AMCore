import { handleConsoleMfa } from '@/shared/api/console/mfa-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export const POST = (request: Request) =>
  withConsoleHostGuard(request, () => handleConsoleMfa(request, true))
