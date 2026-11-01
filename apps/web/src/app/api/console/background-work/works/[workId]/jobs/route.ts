import { handleConsoleWorkJobs } from '@/shared/api/console/background-work-read-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(request: Request, context: { params: Promise<{ workId: string }> }) {
  return withConsoleHostGuard(request, async () => {
    const { workId } = await context.params
    return handleConsoleWorkJobs(request, workId)
  })
}
