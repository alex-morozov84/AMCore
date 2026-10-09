import { createHash } from 'node:crypto'

import { INVITATIONS, ORGANIZATIONS, PRESET_RULES, ROLES } from './organization-roles-data.mjs'

// The fixture SQL guard rejects ON CONFLICT ... DO, so every insert is "rows that are not there yet".
const q = (value) => (value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`)
const textArray = (fields) => `ARRAY[${fields.map(q).join(',')}]::text[]`
const jsonb = (value) => (value === null ? 'NULL' : `${q(value)}::jsonb`)
const template = (name) =>
  `(SELECT id FROM core.roles WHERE name = '${name}' AND "organizationId" IS NULL)`
const FIRST = [
  'Ava',
  'Ben',
  'Chloe',
  'Dan',
  'Eva',
  'Finn',
  'Gina',
  'Hugo',
  'Iris',
  'Jack',
  'Kira',
  'Liam',
]
const LAST = [
  'Nguyen',
  'Okafor',
  'Petrov',
  'Quinn',
  'Rossi',
  'Silva',
  'Tanaka',
  'Usman',
  'Varga',
  'Weber',
  'Yilmaz',
  'Zhang',
]
const RANGE = { 1: [1, 120], 2: [121, 180], 3: [181, 220] }

export function ids(tag) {
  const p = `pv${tag}`
  return {
    p,
    org: (k) => `${p}-org${k}`,
    user: (g) => `${p}-u${g}`,
    member: (g) => `${p}-m${g}`,
    role: (k, i) => `${p}-r${k}-${i}`,
    invite: (n) => `${p}-i${n}`,
  }
}

/** Inserts a VALUES list, skipping rows whose key already exists. */
function missing(table, columns, rows, key) {
  const list = columns.join(', ')
  const same = key.map((k) => `t.${k} = v.${k}`).join(' AND ')
  return `INSERT INTO ${table} (${list}) SELECT ${columns.map((c) => `v.${c}`).join(', ')}
FROM (VALUES ${rows.join(', ')}) AS v(${list}) WHERE NOT EXISTS (SELECT 1 FROM ${table} t WHERE ${same});`
}

/** Inserts a generated series, skipping rows whose id already exists. */
function series(table, columns, idExpression, select, from, to, where = 'true') {
  return `INSERT INTO ${table} (${columns.join(', ')})
SELECT ${select} FROM generate_series(${from}, ${to}) g
WHERE ${where} AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = ${idExpression});`
}

function organizationUnit(id) {
  const rows = ORGANIZATIONS.map(
    (o) => `(${q(id.org(o.key))}, ${q(o.name)}, ${q(o.slug)}, 10, now())`
  )
  return missing(
    'core.organizations',
    ['id', 'name', 'slug', '"aclVersion"', '"updatedAt"'],
    rows,
    ['id']
  )
}

function peopleUnit(id) {
  const email = `'member-' || lpad(g::text, 4, '0') || '@roles.preview.amcore.test'`
  const name = `(ARRAY[${FIRST.map(q)}])[1 + (g % 12)] || ' ' || (ARRAY[${LAST.map(q)}])[1 + ((g / 12) % 12)]`
  const users = series(
    'core.users',
    ['id', 'email', '"emailCanonical"', 'name', '"updatedAt"'],
    `${q(id.p + '-u')} || g`,
    `${q(id.p + '-u')} || g, ${email}, ${email}, ${name}, now()`,
    1,
    220
  )
  const members = ORGANIZATIONS.map((o) => {
    const [from, to] = RANGE[o.key]
    return series(
      'core.org_members',
      ['id', '"userId"', '"organizationId"', '"createdAt"'],
      `${q(id.p + '-m')} || g`,
      `${q(id.p + '-m')} || g, ${q(id.p + '-u')} || g, ${q(id.org(o.key))}, now() - (g || ' days')::interval`,
      from,
      to
    )
  })
  const demo = missing(
    'core.org_members',
    ['id', '"userId"', '"organizationId"'],
    ORGANIZATIONS.map((o) => `(${q(`${id.p}-mdemo${o.key}`)}, :'user', ${q(id.org(o.key))})`),
    ['id']
  )
  return [users, ...members, demo].join('\n')
}

/** Roles, their rules and the links between them. Preset rules mirror the capability adapters exactly. */
function roleUnit(id) {
  const roles = []
  const permissions = []
  const links = []
  const seen = new Set()
  for (const [k, list] of Object.entries(ROLES)) {
    list.forEach(([name, description, rules], i) => {
      const roleId = id.role(k, i)
      roles.push(`(${q(roleId)}, ${q(name)}, ${q(description)}, false, ${q(id.org(k))})`)
      rules.forEach((entry, j) => {
        if (entry === 'oversized') return
        const shared = entry === 'shared'
        const rule = shared ? PRESET_RULES['read:all'] : (PRESET_RULES[entry] ?? entry)
        const permissionId = shared ? `${id.p}-pshared` : `${id.p}-p${k}-${i}-${j}`
        if (!seen.has(permissionId)) {
          seen.add(permissionId)
          permissions.push(
            `(${q(permissionId)}, ${q(rule.action)}, ${q(rule.subject)}, ${jsonb(rule.conditions)}, ${textArray(rule.fields)}, ${rule.inverted}, ${q(id.org(k))})`
          )
        }
        links.push(`(${q(roleId)}, ${q(permissionId)})`)
      })
    })
  }
  return [
    missing('core.roles', ['id', 'name', 'description', '"isSystem"', '"organizationId"'], roles, [
      'id',
    ]),
    missing(
      'core.permissions',
      ['id', 'action', 'subject', 'conditions', 'fields', 'inverted', '"organizationId"'],
      permissions,
      ['id']
    ),
    missing('core.role_permissions', ['"roleId"', '"permissionId"'], links, [
      '"roleId"',
      '"permissionId"',
    ]),
    oversizedUnit(id),
  ].join('\n')
}

/** One role with more rules than the editor accepts; nobody holds it, so authorization never loads it. */
function oversizedUnit(id) {
  const index = ROLES[2].findIndex(([, , rules]) => rules[0] === 'oversized')
  const permission = `${q(id.p + '-pover')} || g`
  return `${series(
    'core.permissions',
    ['id', 'action', 'subject', 'conditions', 'fields', 'inverted', '"organizationId"'],
    permission,
    `${permission}, 'read', 'User', ('{"n":' || g || '}')::jsonb, ARRAY['id']::text[], false, ${q(id.org(2))}`,
    1,
    210
  )}
INSERT INTO core.role_permissions ("roleId", "permissionId")
SELECT ${q(id.role(2, index))}, ${permission} FROM generate_series(1, 210) g
WHERE NOT EXISTS (SELECT 1 FROM core.role_permissions t WHERE t."roleId" = ${q(id.role(2, index))} AND t."permissionId" = ${permission});`
}

function assignmentUnit(id) {
  const link = (suffix, k, role, where, from = 1, to = 220) =>
    series(
      'core.member_roles',
      ['id', '"memberId"', '"roleId"'],
      `${q(id.p + '-mr' + suffix)} || g`,
      `${q(id.p + '-mr' + suffix)} || g, ${q(id.p + '-m')} || g, ${role}`,
      from,
      to,
      where
    )
  const custom = (suffix, k, expression, where) =>
    link(suffix, k, `${q(id.p + '-r' + k + '-')} || (${expression})`, where, ...RANGE[k])
  const explicit = (suffix, member, role) =>
    missing(
      'core.member_roles',
      ['id', '"memberId"', '"roleId"'],
      [`(${q(id.p + '-mrx' + suffix)}, ${q(member)}, ${role})`],
      ['id']
    )
  return [
    link('b', 0, template('MEMBER'), 'g % 50 <> 0'),
    link('v', 0, template('VIEWER'), 'g % 7 = 0 AND g % 50 <> 0'),
    custom('c1a', 1, '0', 'g % 3 = 0 AND g % 50 <> 0'),
    custom('c1b', 1, '1 + (g % 39)', 'g % 3 <> 0 AND g % 50 <> 0'),
    custom('c1c', 1, '1 + ((g + 7) % 39)', 'g % 10 = 1 AND g % 50 <> 0'),
    custom('c2', 2, 'g % 11', 'g % 50 <> 0'),
    custom('c3', 3, 'g % 3', 'g % 50 <> 0'),
    explicit('a1', id.member(2), template('ADMIN')),
    explicit('a2', id.member(125), template('ADMIN')),
    explicit('f1', id.member(5), q(id.role(1, 13))),
    explicit('f2', id.member(5), q(id.role(1, 14))),
    ...ORGANIZATIONS.map((o) => explicit(`d${o.key}`, `${id.p}-mdemo${o.key}`, template('ADMIN'))),
    explicit('dh', `${id.p}-mdemo1`, q(id.role(1, 39))),
  ].join('\n')
}

const STATE = {
  pending: ["now() + interval '7 days'", 'NULL', 'NULL'],
  expired: ["now() - interval '3 days'", 'NULL', 'NULL'],
  revoked: ["now() + interval '7 days'", 'NULL', "now() - interval '1 day'"],
  accepted: ["now() + interval '7 days'", "now() - interval '2 days'", 'NULL'],
}

function invitationUnit(id) {
  const invites = []
  const intents = []
  for (const inv of INVITATIONS) {
    const [expires, accepted, revoked] = STATE[inv.state]
    const email = `invitee-${inv.n}@roles.preview.amcore.test`
    const hash = createHash('sha256')
      .update(`seed-${id.invite(inv.n)}`)
      .digest('hex')
    const acceptedBy = accepted === 'NULL' ? 'NULL' : q(id.user(100 + inv.n))
    const revokedBy = revoked === 'NULL' ? 'NULL' : ":'user'"
    invites.push(
      `(${q(id.invite(inv.n))}, ${q(id.org(inv.org))}, ${q(email)}, ${q(email)}, now() - interval '${inv.n} days', :'user', ${q(hash)}, ${expires}, ${accepted}, ${acceptedBy}, ${revoked}, ${revokedBy}, now())`
    )
    inv.roles.forEach((index, ordinal) => {
      const role = id.role(inv.org, index)
      intents.push(
        `(${q(`${id.invite(inv.n)}-n${ordinal}`)}, ${q(id.invite(inv.n))}, ${ordinal}, ${q(role)}, ${q(role)}, ${q(ROLES[inv.org][index][0])})`
      )
    })
  }
  return [
    missing(
      'core.org_invites',
      [
        'id',
        '"organizationId"',
        '"emailCanonical"',
        'email',
        '"issuedAt"',
        '"invitedById"',
        '"tokenHash"',
        '"expiresAt"',
        '"acceptedAt"',
        '"acceptedByUserId"',
        '"revokedAt"',
        '"revokedById"',
        '"updatedAt"',
      ],
      invites,
      ['id']
    ),
    missing(
      'core.org_invite_role_intents',
      ['id', '"inviteId"', 'ordinal', '"requestedRoleId"', '"liveRoleId"', '"roleNameAtIssue"'],
      intents,
      ['id']
    ),
  ].join('\n')
}

/**
 * Members built to show the access explanation: a field veto, a blocked delete, one holder of more
 * roles than the per-role breakdown covers, and a persisted link to a role of another organization.
 */
function accessCaseUnit(id) {
  const roleIndex = (name) => ROLES[1].findIndex(([n]) => n === name)
  const link = (suffix, member, role) =>
    missing(
      'core.member_roles',
      ['id', '"memberId"', '"roleId"'],
      [`(${q(`${id.p}-mra${suffix}`)}, ${q(member)}, ${q(role)})`],
      ['id']
    )
  const crowd = Array.from({ length: 30 }, (_, i) => link(`crowd${i}`, id.member(9), id.role(1, i)))
  return [
    link('v1', id.member(6), id.role(1, roleIndex('Content editor'))),
    link('v2', id.member(6), id.role(1, roleIndex('Security reviewer'))),
    link('d1', id.member(8), id.role(1, roleIndex('Broad delete'))),
    link('d2', id.member(8), id.role(1, roleIndex('Team coordinator'))),
    link('d3', id.member(8), id.role(1, roleIndex('Compliance reviewer'))),
    ...crowd,
    link('alien', id.member(12), id.role(2, 0)),
  ].join('\n')
}

/** Ordered units; each runs as one marker-locked transaction and is safe to run again. */
export function seedUnits(tag) {
  const id = ids(tag)
  return [
    ['organizations', organizationUnit(id)],
    ['people', peopleUnit(id)],
    ['roles', roleUnit(id)],
    ['assignments', assignmentUnit(id)],
    ['invitations', invitationUnit(id)],
    ['access-cases', accessCaseUnit(id)],
  ]
}
