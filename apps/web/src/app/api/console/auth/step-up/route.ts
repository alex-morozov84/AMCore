import { handleConsoleStepUp } from '@/shared/api/console/step-up'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleStepUp(request))
}
