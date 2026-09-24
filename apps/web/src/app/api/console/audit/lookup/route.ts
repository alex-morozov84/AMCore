import { handleConsoleAuditLookup } from '@/shared/api/console/audit-lookup'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleAuditLookup(request))
}
