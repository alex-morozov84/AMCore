import { invitationHandlers } from '@/_app/invitation-flow/index.server'

export async function POST(request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params
  return invitationHandlers.login(request, flowId)
}
