import type { AiRun } from '@prisma/client'

import { toAiRunResponse } from './ai-run.mapper'

/** Build a minimal terminal `AiRun` row for projection tests (only the mapped fields matter). */
function run(overrides: Partial<AiRun> = {}): AiRun {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    status: 'FAILED',
    errorCode: null,
    terminalReasonCode: null,
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    startedAt: null,
    finishedAt: new Date('2026-07-09T00:00:01.000Z'),
    ...overrides,
  } as AiRun
}

describe('toAiRunResponse', () => {
  it('projects a guardrail refusal: FAILED status + the bounded terminalReasonCode (Arc D)', () => {
    const response = toAiRunResponse(
      run({
        status: 'FAILED',
        errorCode: 'guardrail_blocked',
        terminalReasonCode: 'guardrail_input_blocked',
      })
    )
    expect(response.status).toBe('failed')
    expect(response.errorCode).toBe('guardrail_blocked')
    expect(response.terminalReasonCode).toBe('guardrail_input_blocked')
  })

  it('projects a clean completion with null error/reason', () => {
    const response = toAiRunResponse(run({ status: 'COMPLETED' }))
    expect(response.status).toBe('completed')
    expect(response.errorCode).toBeNull()
    expect(response.terminalReasonCode).toBeNull()
  })
})
