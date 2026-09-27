import { dataAdmission } from './ownership.mjs'
import { save } from './state.mjs'

export async function organizationFixture(m, api) {
  await dataAdmission(m)
  const account = m.accounts.find((a) => a.role === 'USER')
  if (!account) throw new Error('Organization profile requires preview USER')
  const login = await api.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  })
  if (!login.ok()) throw new Error('Organization fixture login failed')
  const { accessToken } = await login.json()
  try {
    const response = await api.post('/api/v1/organizations', {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { name: 'Preview organization', slug: `preview-${m.uuid}` },
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
