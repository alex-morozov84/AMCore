import { invitationHandlers } from '@/_app/invitation-flow/index.server'

export async function POST(request: Request, { params }: { params: Promise<{ flowId: string; attemptId: string }> }) {
  const { flowId, attemptId } = await params
  return invitationHandlers.acknowledge(request, flowId, attemptId)
}
