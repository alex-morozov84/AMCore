import { isRoleDefinitionJsonRequest } from './role-definition-body-parser'

const json = { 'content-type': 'application/json' }
const request = (method: string, url: string, headers: Record<string, unknown> = json) => ({
  method,
  url,
  headers,
})
const base = '/api/v1/organizations/org_1/role-definitions'

describe('isRoleDefinitionJsonRequest', () => {
  it('matches exactly create, save and deletion JSON commands', () => {
    expect(isRoleDefinitionJsonRequest(request('POST', base), '/api/v1')).toBe(true)
    expect(isRoleDefinitionJsonRequest(request('PATCH', `${base}/role_1`), '/api/v1')).toBe(true)
    expect(isRoleDefinitionJsonRequest(request('POST', `${base}/role_1/deletion`), '/api/v1')).toBe(
      true
    )
    expect(isRoleDefinitionJsonRequest(request('POST', `${base}?x=1`), '/api/v1')).toBe(true)
  })

  it('refuses other methods, shapes, encoded ids and non-JSON content', () => {
    expect(isRoleDefinitionJsonRequest(request('GET', base), '/api/v1')).toBe(false)
    expect(isRoleDefinitionJsonRequest(request('PATCH', base), '/api/v1')).toBe(false)
    expect(isRoleDefinitionJsonRequest(request('POST', `${base}/role_1`), '/api/v1')).toBe(false)
    expect(isRoleDefinitionJsonRequest(request('POST', `${base}/role_1/other`), '/api/v1')).toBe(
      false
    )
    expect(
      isRoleDefinitionJsonRequest(request('POST', `${base}/role%2F1/deletion`), '/api/v1')
    ).toBe(false)
    expect(
      isRoleDefinitionJsonRequest(request('POST', '/api/v1/organizations/o/roles'), '/api/v1')
    ).toBe(false)
    expect(
      isRoleDefinitionJsonRequest(
        request('POST', base, { 'content-type': 'text/plain' }),
        '/api/v1'
      )
    ).toBe(false)
    expect(isRoleDefinitionJsonRequest(request('POST', base, {}), '/api/v1')).toBe(false)
  })
})
