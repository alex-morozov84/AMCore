import { handleSupportMail } from '@/shared/api/console/support-mail'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> }
): Promise<Response> {
  return withConsoleHostGuard(request, async () => {
    const params = await context.params
    return handleSupportMail(request, params.id, 'receipt', params.attemptId)
  })
}
