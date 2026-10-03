import { handleConsoleQueues } from '@/shared/api/console/queues-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export function GET(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleQueues(request))
}
