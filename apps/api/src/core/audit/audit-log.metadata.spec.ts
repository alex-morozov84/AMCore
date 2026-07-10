import { sanitizeAuditMetadata } from './audit-log.metadata'

/**
 * Content-free-ness of the AI tool-loop + approval audit metadata (Track C — ADR-054, Arc E). The
 * per-action allowlist must (1) drop any non-declared key, and (2) drop even a declared field whose
 * value is out of its bounded grammar/length — so no tool args, result, prompt, provider body, or
 * unbounded/user-derived string can reach an audit row.
 */
describe('sanitizeAuditMetadata — AI tool-loop + approval actions', () => {
  it('keeps the allowlisted content-free fields for ai.tool.invoked', () => {
    const result = sanitizeAuditMetadata('ai.tool.invoked', {
      toolId: 'current_time',
      riskClass: 'safe',
      invocationId: 'inv1abc',
      runId: 'run1abc',
      outcome: 'succeeded',
    })

    expect(result).toEqual({
      toolId: 'current_time',
      riskClass: 'safe',
      invocationId: 'inv1abc',
      runId: 'run1abc',
      outcome: 'succeeded',
    })
  })

  it('drops non-allowlisted fields (args/result/prompt) for ai.tool.invoked', () => {
    const result = sanitizeAuditMetadata('ai.tool.invoked', {
      toolId: 'current_time',
      args: { location: 'secret' },
      result: 'sensitive tool output',
      prompt: 'system prompt text',
    })

    expect(result).toEqual({ toolId: 'current_time' })
  })

  it('drops a malformed or overlong toolId / reasonCode (bounded code grammar)', () => {
    const result = sanitizeAuditMetadata('ai.tool.execution_failed', {
      toolId: 'Bad-Tool', // uppercase + hyphen is out of the snake grammar
      reasonCode: 'x'.repeat(65), // over the 64-char cap
      riskClass: 'safe',
      runId: 'run1abc',
    })

    expect(result).not.toHaveProperty('toolId')
    expect(result).not.toHaveProperty('reasonCode')
    expect(result).toEqual({ riskClass: 'safe', runId: 'run1abc' })
  })

  it('drops an id that is not cuid-shaped while keeping a snake toolId (bounded id grammar)', () => {
    const result = sanitizeAuditMetadata('ai.approval.requested', {
      approvalId: 'appr_1', // underscore is not part of the cuid id grammar → dropped
      toolId: 'delete_thing', // snake code grammar allows underscores → kept
    })

    expect(result).not.toHaveProperty('approvalId')
    expect(result).toEqual({ toolId: 'delete_thing' })
  })

  it('keeps decision + reasonCode for ai.approval.rejected', () => {
    const result = sanitizeAuditMetadata('ai.approval.rejected', {
      approvalId: 'appr1abc',
      toolId: 'delete_thing',
      riskClass: 'destructive',
      runId: 'run1abc',
      decision: 'reject',
      reasonCode: 'owner_denied',
    })

    expect(result).toMatchObject({
      approvalId: 'appr1abc',
      decision: 'reject',
      reasonCode: 'owner_denied',
    })
  })

  it('drops decision/reasonCode where the action does not declare them (ai.approval.requested)', () => {
    const result = sanitizeAuditMetadata('ai.approval.requested', {
      approvalId: 'appr1abc',
      decision: 'approve',
      reasonCode: 'x',
    })

    expect(result).toEqual({ approvalId: 'appr1abc' })
  })
})
