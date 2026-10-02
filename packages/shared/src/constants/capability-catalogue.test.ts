import { describe, expect, it } from 'vitest'

import { Action } from '../enums/permissions'
import { capabilityCatalogueResponseSchema } from '../schemas/capability'

import { CAPABILITY_CATALOGUE, type CapabilityDescriptor } from './capability-catalogue'

describe('capability catalogue contract', () => {
  it('publishes unique schema-compatible implemented operation IDs', () => {
    const ids = CAPABILITY_CATALOGUE.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(
      capabilityCatalogueResponseSchema.safeParse({ capabilities: CAPABILITY_CATALOGUE }).success
    ).toBe(true)
  })

  it('type-checks a downstream descriptor without shipping a demo subject', () => {
    const fixture = {
      id: 'fixture.read',
      subject: 'Fixture',
      action: Action.Read,
      operation: 'fixture.list',
      method: 'GET',
      path: '/fixture',
      credentials: ['bearer'],
      labelKey: 'fixtureRead',
      presets: ['assigned'],
      editableFields: [],
    } as const satisfies CapabilityDescriptor<'Fixture'>
    expect(fixture.subject).toBe('Fixture')
  })
})
