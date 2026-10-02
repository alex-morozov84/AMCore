import { handleConsoleStorageSetting } from '@/shared/api/console/storage-setting'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export function GET(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleStorageSetting(request))
}

export function PATCH(request: Request): Promise<Response> {
  return withConsoleHostGuard(request, () => handleConsoleStorageSetting(request))
}
