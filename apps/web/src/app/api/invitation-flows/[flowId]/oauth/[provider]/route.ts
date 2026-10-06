import { invitationHandlers } from '@/_app/invitation-flow/index.server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ flowId: string; provider: string }> }
) {
  const { flowId, provider } = await params
  return invitationHandlers.oauth(request, flowId, provider)
}
