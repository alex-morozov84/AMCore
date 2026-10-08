import type { RoleDefinitionDetail } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import {
  baselineDraft,
  isDirty,
  requiredAcknowledgments,
  togglePreset,
  toSaveRequest,
} from './role-draft'

const detail = (over: Partial<RoleDefinitionDetail> = {}): RoleDefinitionDetail => ({
  role: { id: 'r', name: ' Support ', description: null, isSystem: false, organizationId: 'o' },
  aclVersion: 7,
  editMode: 'editable',
  selfHeld: false,
  grantsFullControl: false,
  ruleCount: 1,
  managedPresets: [
    { capabilityId: 'organization.read', presetId: 'own', permissionIds: ['p'], duplicateCount: 0 },
  ],
  advancedRules: [],
  holders: { total: 0, sample: [], truncated: false },
  impact: { liveInvitationCount: 0 },
  ...over,
})
const catalogue = [
  { id: 'teamAccess.manage', risk: 'fullControl' },
  { id: 'organization.read' },
] as never

describe('role draft', () => {
  it('starts from the stored definition at its revision and is clean', () => {
    const base = baselineDraft(detail())
    expect(base).toEqual({
      revision: 7,
      name: ' Support ',
      description: '',
      keys: ['organization.read:own'],
    })
    expect(isDirty(base, base)).toBe(false)
  })

  it('treats a toggle and its undo as clean again, regardless of order', () => {
    const base = baselineDraft(detail())
    const on = togglePreset(base, 'organization.read', 'all')
    expect(isDirty(on, base)).toBe(true)
    expect(isDirty(togglePreset(on, 'organization.read', 'all'), base)).toBe(false)
  })

  it('sends untouched name and description exactly as stored', () => {
    const d = detail()
    const base = baselineDraft(d)
    expect(toSaveRequest(base, d, { fullControl: false, selfHeld: false })).toMatchObject({
      expectedAclVersion: 7,
      name: ' Support ',
      description: null,
    })
  })

  it('fences on the draft revision and turns blank text into null', () => {
    const d = detail({ role: { ...detail().role, description: 'Old' } })
    const stale = { ...baselineDraft(d), revision: 5, description: '   ' }
    const request = toSaveRequest(stale, d, { fullControl: false, selfHeld: false })
    expect(request.expectedAclVersion).toBe(5)
    expect(request.description).toBeNull()
  })

  it('asks for full control only when the draft adds it', () => {
    const d = detail()
    const base = baselineDraft(d)
    const added = togglePreset(base, 'teamAccess.manage', 'all')
    expect(requiredAcknowledgments(added, base, false, catalogue)).toEqual({
      fullControl: true,
      selfHeld: false,
    })
    const heldBase = baselineDraft(detail({ managedPresets: [] }))
    const held = { ...heldBase, keys: ['teamAccess.manage:all'] }
    expect(requiredAcknowledgments(held, held, false, catalogue).fullControl).toBe(false)
  })

  it('asks the self-held confirmation only when the preset set changes', () => {
    const d = detail({ selfHeld: true })
    const base = baselineDraft(d)
    expect(requiredAcknowledgments({ ...base, name: 'New' }, base, true, catalogue).selfHeld).toBe(
      false
    )
    expect(
      requiredAcknowledgments(togglePreset(base, 'organization.read', 'all'), base, true, catalogue)
        .selfHeld
    ).toBe(true)
  })

  it('adds acknowledgments to the request only when required', () => {
    const d = detail()
    const base = baselineDraft(d)
    const body = toSaveRequest(base, d, { fullControl: true, selfHeld: true })
    expect(body).toMatchObject({ acknowledgeFullControl: true, acknowledgeSelfHeld: true })
    expect(toSaveRequest(base, d, { fullControl: false, selfHeld: false })).not.toHaveProperty(
      'acknowledgeFullControl'
    )
  })
})
