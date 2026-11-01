import { handleConsoleWorkJobs } from '@/shared/api/console/background-work-read-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(
  request: Request,
  context: { params: Promise<{ workId: string; jobId: string }> }
) {
  return withConsoleHostGuard(request, async () => {
    const { workId, jobId } = await context.params
    return handleConsoleWorkJobs(request, workId, jobId)
  })
}
