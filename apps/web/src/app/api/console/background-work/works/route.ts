import { handleConsoleWorkCatalogue } from '@/shared/api/console/background-work-read-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(request: Request) {
  return withConsoleHostGuard(request, () => handleConsoleWorkCatalogue(request))
}
