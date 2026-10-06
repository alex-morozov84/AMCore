import {
  type InvitationFlowAccept,
  invitationFlowAcceptResponseSchema,
  invitationFlowAcceptSchema,
  invitationFlowAuthResponseSchema,
  type InvitationFlowBinding,
  invitationFlowContextResponseSchema,
  invitationFlowExpectedSchema,
  invitationFlowIdSchema,
  invitationFlowInspectResponseSchema,
  type InvitationFlowLogin,
  invitationFlowLoginSchema,
  invitationFlowOAuthResponseSchema,
  invitationFlowPendingResponseSchema,
  type InvitationFlowRegister,
  invitationFlowRegisterSchema,
  invitationFlowSwitchResponseSchema,
  invitationFlowVerificationResponseSchema,
  invitationOperationIdSchema,
  invitationOperationResponseSchema,
  invitationVerificationReturnInputSchema,
  invitationVerificationReturnLinkSchema,
  invitationVerificationReturnResponseSchema,
} from '@amcore/shared'

import { apiClient } from '@/shared/api/http-client'

function path(flowId: string, action: string): string {
  return `/invitation-flows/${invitationFlowIdSchema.parse(flowId)}/${action}`
}

/** Headless transport: no design, navigation, account-cache publication or automatic joining. */
export const invitationFlowClient = {
  async context(flowId: string, signal: AbortSignal) {
    return invitationFlowContextResponseSchema
      .or(invitationFlowPendingResponseSchema)
      .parse(await apiClient.get(path(flowId, 'context'), { signal }))
  },
  async inspect(flowId: string, signal: AbortSignal) {
    return invitationFlowInspectResponseSchema
      .or(invitationFlowPendingResponseSchema)
      .parse(await apiClient.get(path(flowId, 'inspect'), { signal }))
  },
  async login(input: InvitationFlowLogin, signal: AbortSignal) {
    const parsed = invitationFlowLoginSchema.parse(input)
    return invitationFlowAuthResponseSchema.parse(
      await apiClient.post(path(parsed.binding.flowId, 'login'), parsed, { signal })
    )
  },
  async register(input: InvitationFlowRegister, signal: AbortSignal) {
    const parsed = invitationFlowRegisterSchema.parse(input)
    return invitationFlowAuthResponseSchema.parse(
      await apiClient.post(path(parsed.binding.flowId, 'register'), parsed, { signal })
    )
  },
  async accept(input: InvitationFlowAccept, signal: AbortSignal) {
    const parsed = invitationFlowAcceptSchema.parse(input)
    return invitationFlowAcceptResponseSchema.parse(
      await apiClient.post(path(parsed.binding.flowId, 'accept'), parsed, { signal })
    )
  },
  async acknowledge(binding: InvitationFlowBinding, attemptId: string, signal: AbortSignal) {
    const attempt = invitationFlowIdSchema.parse(attemptId)
    return invitationFlowAuthResponseSchema.parse(
      await apiClient.post(
        path(binding.flowId, `auth-handoffs/${attempt}/ack`),
        invitationFlowExpectedSchema.parse({ binding }),
        { signal }
      )
    )
  },
  async switchAccount(binding: InvitationFlowBinding, signal: AbortSignal) {
    return invitationFlowSwitchResponseSchema.parse(
      await apiClient.post(
        path(binding.flowId, 'switch-account'),
        invitationFlowExpectedSchema.parse({ binding }),
        { signal }
      )
    )
  },
  async oauth(
    binding: InvitationFlowBinding,
    provider: 'google' | 'github' | 'apple',
    signal: AbortSignal
  ) {
    return invitationFlowOAuthResponseSchema.parse(
      await apiClient.post(
        path(binding.flowId, `oauth/${provider}`),
        invitationFlowExpectedSchema.parse({ binding }),
        { signal }
      )
    )
  },
  async verificationStatus(binding: InvitationFlowBinding, signal: AbortSignal) {
    return invitationFlowVerificationResponseSchema.parse(
      await apiClient.post(
        path(binding.flowId, 'verification-status'),
        invitationFlowExpectedSchema.parse({ binding }),
        { signal }
      )
    )
  },
  async recover(operationId: string, signal: AbortSignal) {
    return invitationOperationResponseSchema.parse(
      await apiClient.get(
        `/invitation-operations/${invitationOperationIdSchema.parse(operationId)}`,
        { signal }
      )
    )
  },
  async verificationReturnLink(binding: InvitationFlowBinding, signal: AbortSignal) {
    return invitationVerificationReturnLinkSchema.parse(
      await apiClient.post(
        path(binding.flowId, 'verification-return'),
        invitationFlowExpectedSchema.parse({ binding }),
        { signal }
      )
    )
  },
  async verificationReturn(
    selectorId: string,
    expectedSessionBinding: string,
    signal: AbortSignal
  ) {
    return invitationVerificationReturnResponseSchema.parse(
      await apiClient.post(
        `/invitation-verification-return/${invitationFlowIdSchema.parse(selectorId)}`,
        invitationVerificationReturnInputSchema.parse({ expectedSessionBinding }),
        { signal }
      )
    )
  },
}
