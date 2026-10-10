import { sanitizeAuditMetadata } from './audit-log.metadata'

describe('background control strict audit metadata', () => {
  it('retains bounded command evidence and drops raw business/transport content', () => {
    const result = sanitizeAuditMetadata('background_work.command_outcome', {
      workId: 'image-processing',
      commandId: '0199c011-0000-7000-8000-000000000001',
      operation: 'retry',
      outcome: 'unknown',
      reasonCode: 'STATE_CHANGED',
      reason: 'SUPPORT-1234',
      snapshotDigest: 'a'.repeat(64),
      count: 1,
      payload: { token: 'fake-token...' },
      exception: 'private-stack',
      providerBody: 'private-body',
      authorization: 'Bearer <fake-token>',
    })
    expect(result).toEqual({
      workId: 'image-processing',
      commandId: '0199c011-0000-7000-8000-000000000001',
      operation: 'retry',
      outcome: 'unknown',
      reasonCode: 'STATE_CHANGED',
      reason: 'SUPPORT-1234',
      snapshotDigest: 'a'.repeat(64),
      count: 1,
    })
  })

  it('drops oversized values instead of making strict audit storage unbounded', () => {
    expect(
      sanitizeAuditMetadata('background_work.command_intent', {
        reason: 'x'.repeat(251),
        commandId: 'x'.repeat(37),
        count: 51,
        workId: 'x'.repeat(65),
        snapshotDigest: 'raw-value',
        outcome: 'unexpected-state',
      })
    ).toEqual({})
  })
})

describe('invitation role intent audit', () => {
  it('keeps the complete role set and generation while dropping raw capabilities', () => {
    expect(
      sanitizeAuditMetadata('org.invite_accepted', {
        actorCredentialType: 'jwt',
        branch: 'accepted',
        generation: 2,
        roleIds: ['role-a', 'role-b'],
        email: 'person@example.test',
        token: 'fake-token',
        continuation: 'fake-continuation',
      })
    ).toEqual({
      actorCredentialType: 'jwt',
      branch: 'accepted',
      generation: 2,
      roleIds: ['role-a', 'role-b'],
    })
  })
})

describe('admin.audit_logs.viewed metadata', () => {
  it('retains filter classes and bounded result count without query values', () => {
    expect(
      sanitizeAuditMetadata('admin.audit_logs.viewed', {
        actor: true,
        action: false,
        target: false,
        organization: true,
        time: true,
        resultCount: 2,
        actorId: 'private-person',
        cursor: 'private-cursor',
      })
    ).toEqual({
      actor: true,
      action: false,
      target: false,
      organization: true,
      time: true,
      resultCount: 2,
    })
    expect(
      sanitizeAuditMetadata('admin.audit_logs.viewed', {
        actor: 'private-person',
        resultCount: 51,
      })
    ).toEqual({})
  })
})

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

  it('keeps only bounded content-free fields for ai.conversation.artifact_accessed (Arc G)', () => {
    const result = sanitizeAuditMetadata('ai.conversation.artifact_accessed', {
      conversationId: 'conv1abc',
      artifactId: 'art1abc',
      kind: 'image',
      actorRole: 'operator',
      reasonRef: 'SUPPORT-1234',
      // Everything below must be dropped — never a storage key, hash, or content type.
      storageKey: 'ai-artifacts/conv1abc/art1abc/original',
      hash: 'deadbeef',
      contentType: 'image/png',
    })

    expect(result).toEqual({
      conversationId: 'conv1abc',
      artifactId: 'art1abc',
      kind: 'image',
      actorRole: 'operator',
      reasonRef: 'SUPPORT-1234',
    })
    expect(result).not.toHaveProperty('storageKey')
    expect(result).not.toHaveProperty('hash')
    expect(result).not.toHaveProperty('contentType')
  })
})
