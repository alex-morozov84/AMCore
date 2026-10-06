import { invitationManagerHandlers, invitationManagerMethodDenied } from '@/_app/organization-access/index.server'

export async function GET(request: Request, context: { params: Promise<{ id: string; operationId: string }> }) {
  const { id, operationId } = await context.params
  return invitationManagerHandlers.receipt(request, id, operationId)
}
const denied = invitationManagerMethodDenied('GET')
export const HEAD = denied
export const OPTIONS = denied
export const POST = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
