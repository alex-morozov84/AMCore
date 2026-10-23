import { handleConsoleIntegrations } from '@/shared/api/console/integrations-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params
  return withConsoleHostGuard(request, () =>
    handleConsoleIntegrations(request, { kind: 'probe', id })
  )
}
