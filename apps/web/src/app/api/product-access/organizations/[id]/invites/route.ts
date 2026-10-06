import {
  invitationManagerHandlers,
  invitationManagerMethodDenied,
} from '@/_app/organization-access/index.server'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return invitationManagerHandlers.list(request, id)
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return invitationManagerHandlers.create(request, id)
}
const denied = invitationManagerMethodDenied('GET, POST')
export const HEAD = denied
export const OPTIONS = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
