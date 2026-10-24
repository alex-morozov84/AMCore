import { randomUUID } from 'node:crypto'
import { sql } from './ownership.mjs'
import { save } from './state.mjs'

const samples = [
  ['local', 'Помощь со входом — обычный аккаунт', true, false, null],
  ['verified', 'Помощь со входом — почта подтверждена', true, true, null],
  ['oauth', 'Помощь со входом — только Google', false, true, null],
  ['empty', 'Помощь со входом — способ входа не сохранён', false, false, null],
  [
    'long',
    'Длинное имя пользователя для проверки понятности интерфейса на узком экране',
    true,
    false,
    null,
  ],
  ['unknown', 'Пример — результат отправки неизвестен', true, false, 'unknown'],
  ['failed', 'Пример — ссылка создана, отправка не началась', true, false, 'not_started'],
  ['expired', 'Пример — результат больше недоступен', true, false, 'expired'],
]
const source = `WITH targets AS (SELECT * FROM jsonb_to_recordset(:'targets'::jsonb)
  AS t(id text, email text, name text, password boolean, verified boolean, outcome text)),
 attempts AS (SELECT * FROM jsonb_to_recordset(:'attempts'::jsonb)
  AS a(id uuid, target text, kind text, outcome text, expired boolean))`

function allocate(m, operator, user) {
  const targets = samples.map(([key, name, password, verified, outcome]) => ({
    id: randomUUID(),
    name,
    password,
    verified,
    outcome,
    email: `support-${key === 'long' ? 'long-address-for-a-narrow-screen-and-confirmation-dialog' : key}@preview.amcore.test`,
  }))
  const attempts = targets
    .filter((t) => t.outcome)
    .flatMap((target) =>
      ['email_verification', 'password_recovery'].map((kind) => ({
        id: randomUUID(),
        target: target.id,
        kind,
        outcome: target.outcome === 'expired' ? 'simulated' : target.outcome,
        expired: target.outcome === 'expired',
      }))
    )
  return { version: 1, stand: m.uuid, operator, user, targets, attempts, prepared: false }
}

/** Fake targets and historical examples; transport remains the ordinary mock provider. */
export async function supportMailFixture(m) {
  if (!m.consoleEnabled || m.purpose !== 'preview' || m.fixtureProfile !== 'support-mail')
    throw new Error('Support mail needs its own enabled-Console preview profile')
  const operator = m.accounts?.find((a) => a.role === 'SUPER_ADMIN')?.id
  const user = m.accounts?.find((a) => a.role === 'USER')?.id
  if (!operator || !user) throw new Error('Support mail demo principals missing')
  let record = m.supportMailFixture
  if (record) {
    if (
      record.version !== 1 ||
      record.stand !== m.uuid ||
      record.operator !== operator ||
      record.user !== user
    )
      throw new Error('Support mail fixture provenance changed; reset refused')
  } else {
    record = allocate(m, operator, user)
    m.supportMailFixture = record
    await save(m)
  }
  if (!record.prepared) {
    const variables = {
      targets: JSON.stringify(record.targets),
      attempts: JSON.stringify(record.attempts),
      operator,
      user,
    }
    const check = await sql(
      m,
      `${source}
      SELECT (SELECT count(*) FROM core.users u JOIN targets t ON u.id=t.id OR u."emailCanonical"=t.email)
        + (SELECT count(*) FROM core.support_mail_attempts s JOIN attempts a ON s.id=a.id);`,
      variables
    )
    if (check.trim() !== '0') throw new Error('Support mail target collision; adoption refused')
    const count = await sql(
      m,
      `${source}, inserted AS (
      INSERT INTO core.users (id,email,"emailCanonical",name,"passwordHash","emailVerified",locale,"updatedAt")
      SELECT t.id,t.email,t.email,t.name,d."passwordHash",t.verified,'ru',now()
      FROM targets t LEFT JOIN core.users d ON t.password AND d.id=:'user' RETURNING id
    ), linked AS (
      INSERT INTO core.oauth_accounts (id,"userId",provider,"providerAccountId")
      SELECT t.id || '-google',t.id,'GOOGLE'::core."OAuthProvider",t.id FROM targets t
      JOIN inserted i ON i.id=t.id WHERE t.email='support-oauth@preview.amcore.test' RETURNING id
    ), receipts AS (
      INSERT INTO core.support_mail_attempts (id,"actorUserId","targetUserId",kind,"recipientBinding","policyBinding",state,provider,reason,
        "tokenId","preparedAt","prepareExpiresAt","claimedAt","tokenIssuedAt","deadlineAt","dispatchAt","settledAt","readUntil","purgeAfter")
      SELECT a.id,:'operator',a.target,a.kind,repeat('0',64),repeat('0',64),a.outcome,'mock',
        r.reason,
        a.id::text,now()-interval '25 hours',now()-interval '24 hours',now()-interval '25 hours',now()-interval '25 hours',
        now()-interval '25 hours'+interval '15 seconds',dispatched.at,
        now()-interval '25 hours'+interval '15 seconds',now()+interval '23 hours' - a.expired::int * interval '24 hours',
        now()+interval '6 days' FROM attempts a JOIN inserted i ON i.id=a.target
        LEFT JOIN (VALUES ('unknown','deadline'),('not_started','render_failed')) r(outcome,reason) ON r.outcome=a.outcome
        LEFT JOIN LATERAL (SELECT now()-interval '25 hours' AS at WHERE a.outcome='unknown') dispatched ON true RETURNING id
    ) SELECT (SELECT count(*) FROM inserted)::text || ':' || (SELECT count(*) FROM linked)::text || ':' || (SELECT count(*) FROM receipts)::text;`,
      variables
    )
    if (count.trim() !== '8:1:6') throw new Error('Unknown fixture result; preserve this stand')
    record.prepared = true
    await save(m)
  }
  console.log(
    'Support mail uses simulation. Historical examples are synthetic; no mail leaves this stand.'
  )
  for (const target of record.targets) console.log(`${target.name}: ${target.email}`)
}

/** A separate agent-only target keeps owner acceptance examples and their links untouched. */
export async function supportMailFeedbackFixture(m) {
  if (!m.supportMailFixture?.prepared || m.fixtureProfile !== 'support-mail')
    throw new Error('Feedback sample needs the admitted support mail fixture')
  if (m.supportMailFeedbackFixture) {
    if (!m.supportMailFeedbackFixture.ready)
      throw new Error('Interrupted feedback sample; preserve data and inspect its result')
    return
  }
  const sample = {
    id: randomUUID(),
    email: 'support-ui-feedback@preview.amcore.test',
    ready: false,
  }
  m.supportMailFeedbackFixture = sample
  await save(m)
  const collisions = await sql(
    m,
    "SELECT count(*) FROM core.users WHERE id=:'id' OR \"emailCanonical\"=:'email';",
    { id: sample.id, email: sample.email }
  )
  if (collisions.trim() !== '0') throw new Error('Feedback sample collision; adoption refused')
  const result = await sql(
    m,
    `INSERT INTO core.users (id,email,"emailCanonical",name,"passwordHash","emailVerified","updatedAt")
    SELECT :'id',:'email',:'email','Agent preview: email feedback',"passwordHash",false,now()
    FROM core.users WHERE id=:'source_user' AND "passwordHash" IS NOT NULL RETURNING id;`,
    { id: sample.id, email: sample.email, source_user: m.supportMailFixture.user }
  )
  if (result.trim().split('\n')[0] !== sample.id)
    throw new Error('Feedback sample result unconfirmed; preserve data')
  sample.ready = true
  await save(m)
}
