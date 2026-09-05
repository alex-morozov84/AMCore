import { describe, expect, it } from 'vitest'

import { aiToolInvocationResponseSchema } from './ai-tools'

/**
 * Contract tests for the AI tool-invocation wire schema (Track C — ADR-054, Arc E.1): the
 * content-free read projection served before the Arc E.5 endpoints serve it.
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
