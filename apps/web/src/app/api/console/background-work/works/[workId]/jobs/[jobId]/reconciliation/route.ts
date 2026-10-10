import { handleConsoleEvidenceReconciliation } from '@/shared/api/console/background-commands-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(
  request: Request,
  context: { params: Promise<{ workId: string; jobId: string }> }
) {
  const { workId, jobId } = await context.params
  return withConsoleHostGuard(request, () =>
    handleConsoleEvidenceReconciliation(request, workId, jobId)
  )
}
