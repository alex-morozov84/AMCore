import {
  isRoleDefinitionFormRequest,
  isRoleDefinitionJsonRequest,
  isRoleDefinitionRequest,
} from './role-definition-body-parser'

const json = { 'content-type': 'application/json' }
const form = { 'content-type': 'application/x-www-form-urlencoded' }
const base = '/api/v1/organizations/org_1/role-definitions'
const at = (url: string) => ({ url })

describe('role-definition budget classification', () => {
  it('matches create, save and deletion paths in every spelling the router accepts', () => {
    for (const url of [
      base,
      `${base}/`,
      `${base}?x=1`,
      `${base}/role_1`,
      `${base}/role_1/`,
      `${base}/role_1/deletion`,
      '/API/V1/Organizations/org_1/Role-Definitions',
      '/api/v1/organizations/org%31/role-definitions',
      '/api/v1//organizations/org_1/role-definitions',
      '/api/v1/organizations/org_1/role-definitions/role%5F1/DELETION',
    ])
      expect(isRoleDefinitionRequest(at(url), '/api/v1')).toBe(true)
  })

  it('does not widen to other routes or shapes', () => {
    for (const url of [
      '/api/v1/organizations/org_1/roles',
      '/api/v1/organizations/org_1/role-definitions/role_1/other',
      '/api/v1/organizations/org_1/role-definitions/role_1/deletion/x',
      '/api/v1/organizations/role-definitions',
      '/api/v1/auth/role-definitions',
      '/other/organizations/org_1/role-definitions',
    ])
      expect(isRoleDefinitionRequest(at(url), '/api/v1')).toBe(false)
  })

  it('works with an empty global prefix', () => {
    expect(isRoleDefinitionRequest(at('/organizations/o/role-definitions'), '')).toBe(true)
  })

  it('selects JSON and form bodies separately and refuses other media', () => {
    expect(isRoleDefinitionJsonRequest({ url: base, headers: json }, '/api/v1')).toBe(true)
    expect(isRoleDefinitionJsonRequest({ url: base, headers: form }, '/api/v1')).toBe(false)
    expect(isRoleDefinitionFormRequest({ url: base, headers: form }, '/api/v1')).toBe(true)
    expect(
      isRoleDefinitionJsonRequest(
        { url: base, headers: { 'content-type': 'Application/JSON; charset=utf-8' } },
        '/api/v1'
      )
    ).toBe(true)
    expect(
      isRoleDefinitionJsonRequest(
        { url: base, headers: { 'content-type': 'text/plain' } },
        '/api/v1'
      )
    ).toBe(false)
    expect(isRoleDefinitionJsonRequest({ url: base, headers: {} }, '/api/v1')).toBe(false)
  })
})
