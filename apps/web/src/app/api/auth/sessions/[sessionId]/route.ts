import { handleDeleteSession } from '@/shared/api/bff/sessions-handler'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params
  return handleDeleteSession(request, sessionId)
}
