import { handleConsoleWorkCommand } from '@/shared/api/console/background-commands-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(request: Request, context: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await context.params
  return withConsoleHostGuard(request, () => handleConsoleWorkCommand(request, commandId))
}
