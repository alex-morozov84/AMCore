import { describe, expect, it } from 'vitest'

import { CAPABILITY_CATALOGUE, type CapabilityDescriptor } from '../constants/capability-catalogue'

import { apiKeyScopeOptions, selectedApiKeyScopes } from './api-key-scope-options'

const options = apiKeyScopeOptions(CAPABILITY_CATALOGUE)
describe('API-key scope options', () => {
  it('adds complete direct requirements without adding read to deletion', () => {
    expect(selectedApiKeyScopes(options, ['delete:Organization'])).toEqual([
      'delete:Organization',
      'manage:TeamAccess',
    ])
    expect(selectedApiKeyScopes(options, ['update:Organization'])).toEqual([
      'read:Organization',
      'update:Organization',
    ])
  })
  it('groups identical primary scopes, unions additions and deduplicates selections', () => {
    const entry = CAPABILITY_CATALOGUE[1]
    const grouped = apiKeyScopeOptions([
      entry,
      { ...entry, id: 'second', additionalApiKeyScopes: ['read:User', 'read:Organization'] },
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.capabilities).toHaveLength(2)
    expect(selectedApiKeyScopes(grouped, ['read:Organization'])).toEqual([
      'read:Organization',
      'read:User',
    ])
  })
  it.each([['manage:all'], ['bad'], [1]])('rejects invalid additional declarations %j', (value) => {
    expect(() =>
      apiKeyScopeOptions([
        {
          ...CAPABILITY_CATALOGUE[1],
          additionalApiKeyScopes: [value],
        } as unknown as CapabilityDescriptor,
      ])
    ).toThrow()
  })
  it('rejects nonempty bearer-only metadata and omits eligible empty declarations', () => {
    const bearer: CapabilityDescriptor = { ...CAPABILITY_CATALOGUE[1], credentials: ['bearer'] }
    expect(apiKeyScopeOptions([bearer])).toEqual([])
    expect(() =>
      apiKeyScopeOptions([{ ...bearer, additionalApiKeyScopes: ['read:Organization'] }])
    ).toThrow()
  })
})
