import { randomUUID } from 'node:crypto'

import { sql } from './ownership.mjs'
import { save } from './state.mjs'

const SAMPLES = [
  ['local', 'password', true, false, []],
  ['oauth', 'Google', false, true, ['GOOGLE']],
  [
    'mixed',
    'password and linked accounts',
    true,
    true,
    ['GOOGLE', 'GOOGLE', 'GITHUB', 'APPLE', 'TELEGRAM'],
  ],
  ['none', 'no saved sign-in methods', false, false, []],
]
const SOURCE = `WITH
  targets AS (SELECT * FROM jsonb_to_recordset(:'targets'::jsonb)
    AS t(id text, email text, name text, password boolean, verified boolean)),
  identities AS (SELECT * FROM jsonb_to_recordset(:'identities'::jsonb)
    AS a(id text, "userId" text, provider text, "providerAccountId" text)),
  events AS (SELECT * FROM jsonb_to_recordset(:'events'::jsonb)
    AS e(id text, action text, "actorId" text, "targetId" text, "targetType" text, "createdAt" timestamp, metadata jsonb))`

function allocate(m, principals) {
  const targets = SAMPLES.map(([key, label, password, verified]) => ({
    id: randomUUID(),
    email: `login-${key}@preview.amcore.test`,
    name: `Login sample: ${label}`,
    password,
    verified,
  }))
  const identities = SAMPLES.flatMap((sample, index) =>
    sample[4].map((provider, n) => ({
      id: randomUUID(),
      userId: targets[index].id,
      provider,
      providerAccountId: `preview-${m.uuid}-${index}-${n}`,
    }))
  )
  const userId = targets[2].id
  const sessionId = randomUUID()
  const actions = [
    'auth.step_up_failed',
    'auth.step_up_succeeded',
    'admin.user.system_role_changed',
    'admin.user.session_revoked',
    'admin.user.sessions_revoked',
  ]
  const events = actions.map((action, index) => ({
    id: randomUUID(),
    action,
    actorId: index < 2 ? userId : principals.operator,
    targetId: index < 2 ? sessionId : userId,
    targetType: index < 2 ? 'SESSION' : 'USER',
    createdAt: new Date(Date.now() - (5 - index) * 3600000).toISOString(),
    metadata:
      index === 0
        ? { reason: 'invalid_password' }
        : index === 1
          ? { sessionId }
          : index === 2
            ? { beforeSystemRole: 'SUPER_ADMIN', afterSystemRole: 'USER' }
            : index === 3
              ? { sessionId, count: 0 }
              : { count: 0 },
  }))
  return {
    version: 1,
    stand: m.uuid,
    principals,
    targets,
    identities,
    events,
    createdAt: new Date().toISOString(),
    prepared: false,
  }
}

function principalsOf(m) {
  if (!m.consoleEnabled || m.purpose !== 'preview' || m.fixtureProfile !== 'login-diagnostics')
    throw new Error('Login diagnostics needs its own enabled-Console preview profile')
  const user = m.accounts?.find((a) => a.role === 'USER')
  const operator = m.accounts?.find((a) => a.role === 'SUPER_ADMIN')
  if (!user?.id || !operator?.id) throw new Error('Login diagnostics demo principals missing')
  return { user: user.id, operator: operator.id }
}

const variablesFor = (record) => ({
  targets: JSON.stringify(record.targets),
  identities: JSON.stringify(record.identities),
  events: JSON.stringify(record.events),
  demo_user: record.principals.user,
})
const jsonResult = (result) => JSON.parse(result.trim().split('\n').at(-1))

async function prepare(m, record, io) {
  const variables = variablesFor(record)
  const check = jsonResult(
    await io.sql(
      m,
      `${SOURCE}
    SELECT jsonb_build_object('collisions', (SELECT count(*) FROM (
      SELECT u.id FROM core.users u JOIN targets t ON u.id=t.id OR u."emailCanonical"=t.email
      UNION ALL SELECT a.id FROM core.oauth_accounts a JOIN identities i
        ON a.id=i.id OR (a.provider::text=i.provider AND a."providerAccountId"=i."providerAccountId")
      UNION ALL SELECT a.id FROM core.audit_log a JOIN events e ON a.id=e.id
    ) collisions), 'sourceReady', EXISTS(SELECT 1 FROM core.users
      WHERE id=:'demo_user' AND "passwordHash" IS NOT NULL AND "passwordHash"<>''));`,
      variables
    )
  )
  if (check.collisions !== 0 || !check.sourceReady)
    throw new Error(
      'Login diagnostics identity collision or missing demo password; adoption refused'
    )
  const counts = jsonResult(
    await io.sql(
      m,
      `${SOURCE},
    inserted_users AS (
      INSERT INTO core.users (id,email,"emailCanonical",name,"passwordHash","emailVerified","updatedAt")
      SELECT t.id,t.email,t.email,t.name,d."passwordHash",t.verified,now()
      FROM targets t LEFT JOIN core.users d ON t.password AND d.id=:'demo_user' RETURNING id
    ), inserted_links AS (
      INSERT INTO core.oauth_accounts (id,"userId",provider,"providerAccountId")
      SELECT a.id,a."userId",a.provider::core."OAuthProvider",a."providerAccountId"
      FROM identities a JOIN inserted_users u ON u.id=a."userId" RETURNING id
    ), inserted_events AS (
      INSERT INTO core.audit_log (id,action,"actorType","actorId","targetType","targetId","createdAt",metadata)
      SELECT e.id,e.action,'USER'::core."AuditActorType",e."actorId",
        e."targetType"::core."AuditTargetType",e."targetId",e."createdAt",e.metadata
      FROM events e WHERE (SELECT count(*) FROM inserted_users)=4 RETURNING id
    ) SELECT jsonb_build_object('users',(SELECT count(*) FROM inserted_users),
      'links',(SELECT count(*) FROM inserted_links),'events',(SELECT count(*) FROM inserted_events));`,
      variables
    )
  )
  if (counts.users !== 4 || counts.links !== 6 || counts.events !== 5)
    throw new Error('Login diagnostics preparation has an unknown result; preserve this stand')
  record.prepared = true
  await io.save(m)
}

async function report(m, record, io) {
  const rows = jsonResult(
    await io.sql(
      m,
      `SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'name',name)), '[]'::jsonb)
     FROM core.users WHERE id IN (SELECT value FROM jsonb_array_elements_text(:'ids'::jsonb));`,
      { ids: JSON.stringify(record.targets.map((t) => t.id)) }
    )
  )
  io.log(
    'Login samples are inspection targets, not demo sign-in accounts. Provider links and security events are synthetic.'
  )
  for (const target of record.targets) {
    const current = rows.find((row) => row.id === target.id)
    io.log(
      current ? `${current.name}: ${current.email}` : `${target.email}: removed; not recreated`
    )
  }
}

/** Separate targets never enter the principal password-login loop. */
export async function loginDiagnosticsFixture(m, overrides = {}) {
  const io = { sql, save, log: console.log, ...overrides }
  const principals = principalsOf(m)
  let record = m.loginDiagnosticsFixture
  if (record) {
    if (
      record.version !== 1 ||
      record.stand !== m.uuid ||
      record.principals.user !== principals.user ||
      record.principals.operator !== principals.operator
    )
      throw new Error('Login diagnostics provenance changed; reset refused')
    if (!record.prepared)
      throw new Error(
        'Login diagnostics preparation was interrupted. Preserve these data or use a fresh stand ID; automatic reseeding refused'
      )
  } else {
    record = allocate(m, principals)
    m.loginDiagnosticsFixture = record
    await io.save(m)
    await prepare(m, record, io)
  }
  await report(m, record, io)
}
