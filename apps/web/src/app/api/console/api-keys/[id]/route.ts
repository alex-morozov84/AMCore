import { handleConsoleApiKeyRevoke } from '@/shared/api/console/api-keys-revoke'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withConsoleHostGuard(request, async () => {
    const { id } = await context.params
    return handleConsoleApiKeyRevoke(request, id)
  })
}
