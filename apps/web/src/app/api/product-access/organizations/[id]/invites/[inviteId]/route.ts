import { invitationManagerHandlers, invitationManagerMethodDenied } from '@/_app/organization-access/index.server'

export async function DELETE(request: Request, context: { params: Promise<{ id: string; inviteId: string }> }) {
  const { id, inviteId } = await context.params
  return invitationManagerHandlers.revoke(request, id, inviteId)
}
const denied = invitationManagerMethodDenied('DELETE')
export const HEAD = denied
export const OPTIONS = denied
export const GET = denied
export const POST = denied
export const PUT = denied
export const PATCH = denied
