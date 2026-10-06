import { invitationManagerHandlers, invitationManagerMethodDenied } from '@/_app/organization-access/index.server'

export async function POST(request: Request, context: { params: Promise<{ id: string; inviteId: string }> }) {
  const { id, inviteId } = await context.params
  return invitationManagerHandlers.reissue(request, id, inviteId)
}
const denied = invitationManagerMethodDenied('POST')
export const HEAD = denied
export const OPTIONS = denied
export const GET = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
