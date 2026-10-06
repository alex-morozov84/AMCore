import type { InvitationFlowAuthResponse, InvitationFlowBinding, LoginInput, RegisterInput, UserResponse } from '@amcore/shared'

import { invitationFlowClient } from '@/entities/invitation-flow'
import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import type { CredentialFormAdapter } from '@/shared/lib/credential-form-adapter'

interface Continuation {
  binding: InvitationFlowBinding
  isCurrent(): boolean
  onStart?(): void
  onHandoff(binding: InvitationFlowBinding, attemptId: string): void
  onConfirmed(binding: InvitationFlowBinding, user: UserResponse): void
  onFailure(error: unknown): void | Promise<void>
}

function changed(): never {
  throw new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
}

/** Reuses ordinary credential forms while keeping invitation navigation owned by composition. */
export function createInvitationCredentialAdapters(
  continuation: Continuation,
  transport: Pick<typeof invitationFlowClient, 'login' | 'register' | 'acknowledge'> = invitationFlowClient
) {
  function adapter<TInput>(authenticate: (input: TInput, signal: AbortSignal) => Promise<InvitationFlowAuthResponse>): CredentialFormAdapter<TInput> {
    let confirmed: InvitationFlowAuthResponse | undefined
    let started = false
    return {
      isCurrent: () => continuation.isCurrent(),
      async submit(input) {
        if (started || !continuation.isCurrent()) changed()
        started = true
        try {
        continuation.onStart?.()
        const response = await authenticate(input, AbortSignal.timeout(15000))
        if (!continuation.isCurrent() || response.binding.flowId !== continuation.binding.flowId ||
          response.binding.flowRevision !== continuation.binding.flowRevision + 2 ||
          response.binding.sessionBinding === null) changed()
        continuation.onHandoff(response.binding, response.handoff.attemptId)
        const ack = await transport.acknowledge(response.binding, response.handoff.attemptId, AbortSignal.timeout(15000))
        if (!continuation.isCurrent() || ack.binding.flowId !== response.binding.flowId ||
          ack.binding.flowRevision !== response.binding.flowRevision ||
          ack.binding.sessionBinding !== response.binding.sessionBinding ||
          ack.handoff.attemptId !== response.handoff.attemptId) changed()
        confirmed = ack
        return ack.data
        } catch (error) {
          if (continuation.isCurrent()) await continuation.onFailure(error)
          throw error
        }
      },
      onSuccess(response) {
        if (confirmed && continuation.isCurrent()) continuation.onConfirmed(confirmed.binding, response.user)
      },
    }
  }
  return {
    login: adapter<LoginInput>((input, signal) => transport.login({ ...input, binding: continuation.binding }, signal)),
    register: adapter<RegisterInput>((input, signal) => transport.register({
      binding: continuation.binding, password: input.password, name: input.name, locale: input.locale,
    }, signal)),
  }
}
