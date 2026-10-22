import { handleConsoleScheduledJobs } from '@/shared/api/console/scheduled-jobs-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export function GET(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleScheduledJobs(request))
}
