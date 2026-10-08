import { ORGANIZATIONS } from './organization-roles-data.mjs'
import { ids, seedUnits } from './organization-roles-sql.mjs'
import { sql } from './ownership.mjs'
import { save } from './state.mjs'

const TOTAL_CUSTOM_ROLES = 55
const MARKER_VERSION = 1

/**
 * Large reproducible data for the role editor owner preview: 3 organizations, 55 custom roles,
 * 220 fake members and 14 invitations. Rows are written only through marker-locked fixture SQL
 * (no raw database access) and are skipped when already present, so a half-finished first seed
 * simply continues. Repeat runs verify the recorded identity and never reset the owner's edits.
 */
export async function organizationRolesFixture(m, api) {
  const account = m.accounts.find((a) => a.role === 'USER')
  if (!account) throw new Error('Organization roles profile requires preview USER')
  const tag = m.uuid.replaceAll('-', '').slice(0, 8)
  const record = (m.rolesFixture ??= { version: MARKER_VERSION, tag, userId: account.id })
  if (record.userId !== account.id || record.tag !== tag || record.version !== MARKER_VERSION)
    throw new Error('Preview roles dataset belongs to a different identity; refusing silent reset')
  if (record.complete) return
  for (const [, query] of seedUnits(tag)) await sql(m, query, { user: account.id })
  await verifyDataset(m, tag)
  await verifyThroughApi(m, api, account, tag)
  record.complete = true
  await save(m)
}

async function verifyDataset(m, tag) {
  const id = ids(tag)
  const orgs = ORGANIZATIONS.map((o) => `'${id.org(o.key)}'`).join(', ')
  const count = async (query) => Number((await sql(m, query)).trim())
  const found = {
    organizations: await count(`SELECT count(*) FROM core.organizations WHERE id IN (${orgs});`),
    roles: await count(`SELECT count(*) FROM core.roles WHERE "organizationId" IN (${orgs});`),
    members: await count(
      `SELECT count(*) FROM core.org_members WHERE "organizationId" IN (${orgs}) AND "userId" LIKE '${id.p}-u%';`
    ),
  }
  if (found.organizations !== 3 || found.roles !== TOTAL_CUSTOM_ROLES || found.members !== 220)
    throw new Error(`Preview roles dataset is incomplete: ${JSON.stringify(found)}`)
}

/** The editor must recognise the seeded rules as it will in the browser, not merely find rows. */
async function verifyThroughApi(m, api, account, tag) {
  const id = ids(tag)
  const login = await api.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  })
  if (!login.ok()) throw new Error('Roles dataset verification login failed')
  const { accessToken } = await login.json()
  const headers = { authorization: `Bearer ${accessToken}` }
  try {
    const base = `/api/v1/organizations/${id.org(1)}/role-definitions`
    const list = await (await api.get(`${base}?limit=100`, { headers })).json()
    const named = (name) => list.data?.find((role) => role.name === name)
    if (list.total !== 43 || !named('Support agent') || !named('Compliance reviewer'))
      throw new Error('Roles dataset list not recognised by the API')
    const read = async (role) => (await api.get(`${base}/${role.id}`, { headers })).json()
    const preset = await read(named('Support agent'))
    const advanced = await read(named('Compliance reviewer'))
    if (preset.managedPresets?.length !== 1 || advanced.advancedRules?.length !== 1)
      throw new Error('Roles dataset rules not classified as designed')
    const big = await (
      await api.get(`/api/v1/organizations/${id.org(2)}/role-definitions?search=Oversized`, {
        headers,
      })
    ).json()
    if (big.data?.[0]?.advancedState === 'none') throw new Error('Oversized sample not detected')
  } finally {
    await api.post('/api/v1/auth/logout', { headers })
  }
}

export function organizationRolesAddresses(m, localePrefix, product) {
  const id = ids(m.rolesFixture.tag)
  return ORGANIZATIONS.map(
    (o) => `${o.name}: ${product}${localePrefix}/organizations/${id.org(o.key)}/roles`
  )
}
