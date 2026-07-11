import {
  aiApprovalListQuerySchema,
  aiApprovalResponseSchema,
  aiToolInvocationResponseSchema,
  decideAiApprovalSchema,
} from '@amcore/shared'

/**
 * Contract tests for the AI tool-loop + approval wire schemas (Track C — ADR-054, Arc E.1): the
 * content-free tool-invocation read projection, the approval read projection, the list filter, and
 * the owner decision input. These fix the wire shapes before the Arc E.5 endpoints serve them.
 */

describe('aiToolInvocationResponseSchema', () => {
  const valid = {
    id: 'inv_1',
    runId: 'run_1',
    toolId: 'current_time',
    status: 'succeeded',
    riskClass: 'safe',
    approvalId: null,
    errorCode: null,
    durationMs: 12,
    createdAt: '2026-07-10T00:00:00.000Z',
    startedAt: '2026-07-10T00:00:00.000Z',
    finishedAt: '2026-07-10T00:00:00.012Z',
  }

  it('accepts a valid content-free projection', () => {
    expect(aiToolInvocationResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(aiToolInvocationResponseSchema.safeParse({ ...valid, status: 'bogus' }).success).toBe(
      false
    )
  })

  it('constrains toolId to the shared identifier grammar on the wire', () => {
    expect(aiToolInvocationResponseSchema.safeParse({ ...valid, toolId: 'Bad-Tool' }).success).toBe(
      false
    )
    expect(
      aiToolInvocationResponseSchema.safeParse({ ...valid, toolId: 'a'.repeat(49) }).success
    ).toBe(false)
  })
})

describe('aiApprovalResponseSchema', () => {
  const valid = {
    id: 'appr_1',
    runId: 'run_1',
    conversationId: 'conv_1',
    kind: 'tool_invocation',
    state: 'pending',
    toolId: 'delete_thing',
    riskClass: 'destructive',
    requestedReason: 'needs owner sign-off',
    expiresAt: '2026-07-11T00:00:00.000Z',
    decidedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
  }

  it('accepts a valid pending approval', () => {
    expect(aiApprovalResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an unknown approval state', () => {
    expect(aiApprovalResponseSchema.safeParse({ ...valid, state: 'maybe' }).success).toBe(false)
  })

  it('bounds requestedReason to the documented max on the wire', () => {
    expect(
      aiApprovalResponseSchema.safeParse({ ...valid, requestedReason: 'x'.repeat(501) }).success
    ).toBe(false)
  })
})

describe('aiApprovalListQuerySchema', () => {
  it('accepts a pending status filter and an empty query', () => {
    expect(aiApprovalListQuerySchema.safeParse({ status: 'pending' }).success).toBe(true)
    expect(aiApprovalListQuerySchema.safeParse({}).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(aiApprovalListQuerySchema.safeParse({ status: 'nope' }).success).toBe(false)
  })
})

describe('decideAiApprovalSchema', () => {
  it('accepts approve/reject with an optional reason', () => {
    expect(decideAiApprovalSchema.safeParse({ decision: 'approve' }).success).toBe(true)
    expect(
      decideAiApprovalSchema.safeParse({ decision: 'reject', reason: 'too risky' }).success
    ).toBe(true)
  })

  it('rejects a decision outside approve/reject', () => {
    expect(decideAiApprovalSchema.safeParse({ decision: 'defer' }).success).toBe(false)
  })

  it('rejects an over-long reason', () => {
    expect(
      decideAiApprovalSchema.safeParse({ decision: 'reject', reason: 'x'.repeat(501) }).success
    ).toBe(false)
  })
})
