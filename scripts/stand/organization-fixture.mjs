import { dataAdmission, sql } from './ownership.mjs'
import { save } from './state.mjs'

export async function organizationFixture(m, api) {
  await dataAdmission(m)
  const account = m.accounts.find((a) => a.role === 'USER')
  if (!account) throw new Error('Organization profile requires preview USER')
  if (m.organization && m.organization.userId !== account.id) {
    m.legacyOrganizations = [...(m.legacyOrganizations ?? []), m.organization]
    delete m.organization
    await save(m)
  }
  if (m.organization) {
    const roles = await sql(
      m,
      `SELECT r.name FROM core.org_members om
      JOIN core.member_roles mr ON mr."memberId" = om.id
      JOIN core.roles r ON r.id = mr."roleId"
      WHERE om."userId" = :'user' AND om."organizationId" = :'organization';`,
      true,
      { user: account.id, organization: m.organization.id }
    )
    if (!roles.trim().split('\n').includes('ADMIN'))
      throw new Error('Preview organization membership changed; refusing silent reset')
    return
  }
  const login = await api.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  })
  if (!login.ok()) throw new Error('Organization fixture login failed')
  const { accessToken } = await login.json()
  try {
    const response = await api.post('/api/v1/organizations', {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { name: 'Preview organization', slug: `preview-${m.uuid}-demo` },
    })
    if (response.status() !== 201)
      throw new Error(`Organization fixture failed (${response.status()})`)
    const organization = await response.json()
    if (!organization.id) throw new Error('Organization fixture identity missing')
    m.organization = { id: organization.id, userId: account.id, role: 'ADMIN' }
    await save(m)
  } finally {
    // Drop the temporary API login; the reviewer receives a fresh BFF login.
    const logout = await api.post('/api/v1/auth/logout', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    requireLogout(logout)
  }
}

function requireLogout(response) {
  if (!response.ok()) throw new Error('Temporary organization login logout failed')
}
