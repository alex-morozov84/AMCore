import { handleConsoleApiKeyRevoke } from '@/shared/api/console/api-keys-revoke'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request) {
  return withConsoleHostGuard(request, () => handleConsoleApiKeyRevoke(request))
}
