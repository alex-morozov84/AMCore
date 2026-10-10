import { handleConsoleWorkJobs } from '@/shared/api/console/background-work-read-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(request: Request, context: { params: Promise<{ workId: string }> }) {
  const { workId } = await context.params
  return withConsoleHostGuard(request, () => handleConsoleWorkJobs(request, workId))
}
