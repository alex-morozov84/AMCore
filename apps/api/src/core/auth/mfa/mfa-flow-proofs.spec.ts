import { randomUUID } from 'node:crypto'

import { type FlowProofs, resolveFlowProofs } from './mfa-flow-proofs.js'
import { requiredMfaProofs } from './mfa-policy.js'

const now = new Date('2026-10-26T12:00:00Z')
const source = {
  primaryMethod: 'password',
  id: 'F',
  primaryAt: now,
  primaryProofId: randomUUID(),
  mfaAt: now,
  mfaProofId: randomUUID(),
  mfaMethod: 'recovery_code',
  factorVersion: 2,
}
const scope = { flowId: 'flow-A', sourceFamilyId: 'F', source, codeGeneration: 3 }
function proofs(kind: 'family' | 'flow' = 'family'): FlowProofs {
  const origin =
    kind === 'family' ? ({ kind, familyId: 'F' } as const) : ({ kind, flowId: 'flow-A' } as const)
  return {
    primary: { eventId: randomUUID(), method: 'password', verifiedAt: now.toISOString(), origin },
    secondFactor: {
      eventId: randomUUID(),
      method: 'recovery_code',
      verifiedAt: now.toISOString(),
      origin,
      factorVersion: 2,
      recoveryGeneration: 3,
    },
  }
}

describe('Bounded flow proof provenance', () => {
  it('reevaluates changed references against F without borrowing from G', () => {
    const data = proofs()
    expect(resolveFlowProofs(data, scope)).toMatchObject({
      primaryProofId: source.primaryProofId,
      mfaProofId: source.mfaProofId,
    })
    const current = { ...source, primaryProofId: randomUUID(), mfaAt: new Date(0) }
    const evidence = resolveFlowProofs(data, { ...scope, source: current })
    expect(evidence.primaryProofId).toBe(current.primaryProofId)
    expect(requiredMfaProofs(evidence, 2, now)).toEqual(['second_factor'])
    expect(
      requiredMfaProofs(
        resolveFlowProofs(data, { ...scope, source: { ...source, id: 'G' } }),
        2,
        now
      )
    ).toEqual(['password', 'second_factor'])
  })

  it('preserves a local proof while the other proof ages during the flow', () => {
    const data = proofs('flow')
    data.primary!.verifiedAt = new Date(now.getTime() - 600_001).toISOString()
    const evidence = resolveFlowProofs(data, scope)
    expect(requiredMfaProofs(evidence, 2, now)).toEqual(['password'])
    expect(evidence.mfaProofId).toBe(data.secondFactor!.eventId)
    expect(requiredMfaProofs(evidence, 2, new Date(now.getTime() + 600_001))).toEqual([
      'password',
      'second_factor',
    ])
  })

  it('rejects local proof from another flow and old uncommitted backup generation', () => {
    const data = proofs('flow')
    expect(
      requiredMfaProofs(resolveFlowProofs(data, { ...scope, flowId: 'flow-B' }), 2, now)
    ).toEqual(['password', 'second_factor'])
    expect(
      requiredMfaProofs(resolveFlowProofs(data, { ...scope, codeGeneration: 4 }), 2, now)
    ).toEqual(['second_factor'])
    expect(
      requiredMfaProofs(resolveFlowProofs(proofs(), { ...scope, codeGeneration: 4 }), 2, now)
    ).toEqual([])
  })

  it('does not accept future, obsolete-factor or malformed evidence', () => {
    expect(
      requiredMfaProofs(
        resolveFlowProofs(proofs(), {
          ...scope,
          source: { ...source, primaryMethod: 'oauth' },
        }),
        2,
        now
      )
    ).toEqual(['password'])
    const data = proofs('flow')
    data.secondFactor!.verifiedAt = new Date(now.getTime() + 1).toISOString()
    expect(requiredMfaProofs(resolveFlowProofs(data, scope), 2, now)).toEqual(['second_factor'])
    expect(requiredMfaProofs(resolveFlowProofs(proofs('flow'), scope), 3, now)).toEqual([
      'second_factor',
    ])
    expect(
      requiredMfaProofs(resolveFlowProofs({ ...data, verified: true }, scope), 2, now)
    ).toEqual(['password', 'second_factor'])
  })
})
