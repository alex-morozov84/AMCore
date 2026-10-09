import { ORGANIZATIONS } from './organization-roles-data.mjs'
import { ids, seedUnits } from './organization-roles-sql.mjs'
import { sql } from './ownership.mjs'
import { save } from './state.mjs'

const TOTAL_CUSTOM_ROLES = 55
const MARKER_VERSION = 1
/** The units the first version of this profile seeded; a complete record without a list had these. */
const ORIGINAL_UNITS = ['organizations', 'people', 'roles', 'assignments', 'invitations']

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
  // Units are recorded as they are applied, so a dataset seeded by an earlier version of this profile
  // gets only the units it lacks and the owner's edits are never undone.
  const applied = new Set(record.units ?? (record.complete ? ORIGINAL_UNITS : []))
  const units = seedUnits(tag).filter(([label]) => !applied.has(label))
  if (units.length === 0) return reportAccessCases(m, api, account, tag)
  for (const [label, query] of units) {
    await sql(m, query, { user: account.id })
    applied.add(label)
    record.units = [...applied]
    await save(m)
  }
  if (!record.complete) {
    await verifyDataset(m, tag)
    await verifyThroughApi(m, api, account, tag)
    record.complete = true
    await save(m)
  }
  await reportAccessCases(m, api, account, tag)
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

/** Members built to show the access explanation, with how to read each one in the product. */
const ACCESS_CASES = [
  { member: 5, label: 'combination', check: (b) => b.widening?.synergy === true },
  {
    member: 6,
    label: 'veto on the address',
    check: (b) => item(b, 'organization.update.slug')?.reason === 'vetoed',
  },
  {
    member: 8,
    label: 'delete blocked by a deny rule',
    check: (b) => item(b, 'organization.delete')?.reason === 'vetoed',
  },
  {
    member: 9,
    label: 'many roles, no breakdown by role',
    check: (b) => b.widening?.status === 'unavailable',
  },
  {
    member: 12,
    label: 'link to a role of another organization',
    check: (b) => b.unsafeLinkCount === 1,
  },
]
const item = (body, key) => body.items?.find((entry) => entry.key === key)

/**
 * Reads the access explanation of the special members through the real API and prints who shows what.
 * A case the owner's edits removed (a deleted role) is reported as not available, never as a failure.
 */
async function reportAccessCases(m, api, account, tag) {
  const id = ids(tag)
  const login = await api.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  })
  if (!login.ok()) throw new Error('Access cases login failed')
  const { accessToken } = await login.json()
  const headers = { authorization: `Bearer ${accessToken}` }
  try {
    console.log('Access view (Acme Studio, Members tab, Access):')
    for (const entry of ACCESS_CASES) {
      const response = await api.get(
        `/api/v1/organizations/${id.org(1)}/members/${id.user(entry.member)}/access`,
        { headers }
      )
      const body = response.ok() ? await response.json() : {}
      const who = body.member
        ? `${body.member.name ?? ''} <${body.member.email}>`
        : `member ${entry.member}`
      console.log(
        `  ${who}: ${entry.label}${entry.check(body) ? '' : ' (not available: roles were changed)'}`
      )
    }
  } finally {
    await api.post('/api/v1/auth/logout', { headers })
  }
}
