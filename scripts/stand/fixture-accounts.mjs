import { randomBytes } from 'node:crypto'
import { sql } from './ownership.mjs'
import { save } from './state.mjs'

export async function fixtureAccounts(m, api, profile) {
  m.accounts ??= []
  const roles = ['USER', ...(m.consoleEnabled && profile !== 'user' ? ['SUPER_ADMIN'] : [])]
  for (const role of roles) {
    let account = m.accounts.find((a) => a.role === role)
    if (account && !account.pending) continue
    if (!account) {
      account = {
        email: `${role.toLowerCase()}-${m.uuid}@preview.amcore.test`,
        password: `Preview!Aa1${randomBytes(18).toString('hex')}`,
        role,
        pending: true,
      }
      m.accounts.push(account)
      await save(m)
    }
    await completeAccount(m, api, account)
  }
}
async function completeAccount(m, api, account) {
  const variables = { email: account.email, role: account.role }
  let id = (
    await sql(m, `SELECT id FROM core.users WHERE "emailCanonical" = :'email';`, true, variables)
  ).trim()
  if (!id) {
    const response = await api.post('/api/v1/auth/register', {
      data: { email: account.email, password: account.password, name: 'Preview account' },
    })
    if (response.status() !== 201)
      throw new Error(`Preview registration failed (${response.status()})`)
    id = (await response.json()).user?.id
  } else {
    const login = await api.post('/api/v1/auth/login', {
      data: { email: account.email, password: account.password },
    })
    if (!login.ok() || (await login.json()).user?.id !== id)
      throw new Error('Pending fixture ownership not proved by its credentials')
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || (account.id && account.id !== id))
    throw new Error('Invalid/changed fixture identity')
  account.id = id
  await save(m)
  const role = (
    await sql(m, `SELECT "systemRole" FROM core.users WHERE id = :'id';`, true, { id })
  ).trim()
  if (!['USER', account.role].includes(role))
    throw new Error('Unexpected pending fixture role; reset refused')
  await sql(
    m,
    `UPDATE core.users SET "systemRole" = :'role' WHERE id = :'id' AND "emailCanonical" = :'email'; DELETE FROM core.sessions WHERE "userId" = :'id';`,
    true,
    { ...variables, id }
  )
  delete account.pending
  await save(m)
}
