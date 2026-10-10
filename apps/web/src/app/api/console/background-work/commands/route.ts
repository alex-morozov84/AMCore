import { handleConsoleWorkCommand } from '@/shared/api/console/background-commands-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request) {
  return withConsoleHostGuard(request, () => handleConsoleWorkCommand(request))
}
