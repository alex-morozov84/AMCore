import type { RoleDefinitionPreset } from '@amcore/shared'

import { presetKey, type StoredRule } from './role-definition-classifier'
import { planPresetChange } from './role-definition-rules'

const readOwn = (id: string): StoredRule => ({
  id,
  action: 'read',
  subject: 'Organization',
  conditions: { id: '${user.organizationId}' },
  fields: [],
  inverted: false,
})
const advancedDeny: StoredRule = {
  id: 'deny-1',
  action: 'read',
  subject: 'User',
  conditions: { id: 'x' },
  fields: ['name'],
  inverted: true,
}
const select = (...presets: RoleDefinitionPreset[]): Map<string, RoleDefinitionPreset> =>
  new Map(presets.map((preset) => [presetKey(preset), preset]))
const read: RoleDefinitionPreset = { capabilityId: 'organization.read', presetId: 'own' }
const update: RoleDefinitionPreset = { capabilityId: 'organization.update', presetId: 'own' }

describe('planPresetChange', () => {
  it('keeps unchanged managed rows and adds only the missing preset', () => {
    const plan = planPresetChange([readOwn('p1')], select(read, update))
    expect(plan).toEqual({ removeIds: [], additions: [update], removedPresets: 0 })
  })

  it('removes every duplicate of a deselected preset but never an advanced rule', () => {
    const plan = planPresetChange([readOwn('p1'), readOwn('p2'), advancedDeny], select())
    expect(plan.removeIds.sort()).toEqual(['p1', 'p2'])
    expect(plan.removedPresets).toBe(1)
    expect(plan.removeIds).not.toContain('deny-1')
  })

  it('is a no-op when the selection equals the persisted presets, duplicates included', () => {
    const plan = planPresetChange([readOwn('p1'), readOwn('p2'), advancedDeny], select(read))
    expect(plan).toEqual({ removeIds: [], additions: [], removedPresets: 0 })
  })
})
