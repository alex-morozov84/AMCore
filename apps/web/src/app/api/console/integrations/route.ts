import { handleConsoleIntegrations } from '@/shared/api/console/integrations-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export function GET(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleIntegrations(request, { kind: 'list' }))
}
