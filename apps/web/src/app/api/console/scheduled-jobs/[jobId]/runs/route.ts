import { handleConsoleScheduledJobRuns } from '@/shared/api/console/scheduled-jobs-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const { jobId } = await context.params
  return withConsoleHostGuard(request, () => handleConsoleScheduledJobRuns(request, jobId))
}
