import { invitationHandlers } from '@/_app/invitation-flow/index.server'

export async function GET(request: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params
  return invitationHandlers.operation(request, operationId)
}
