import { invitationHandlers } from '@/_app/invitation-flow/index.server'

export async function POST(request: Request, { params }: { params: Promise<{ selectorId: string }> }) {
  return invitationHandlers.verificationReturn(request, (await params).selectorId)
}
