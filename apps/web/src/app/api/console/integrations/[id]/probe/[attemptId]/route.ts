import { handleConsoleIntegrations } from '@/shared/api/console/integrations-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> }
): Promise<Response> {
  const { id, attemptId } = await context.params
  return withConsoleHostGuard(request, () =>
    handleConsoleIntegrations(request, { kind: 'receipt', id, attemptId })
  )
}
