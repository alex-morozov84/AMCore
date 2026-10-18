import { createHash } from 'node:crypto'
import { organizationFixture } from './organization-fixture.mjs'
import { sql } from './ownership.mjs'
import { save } from './state.mjs'

/** Non-authenticating sample credentials, written only through managed marker admission. */
export async function memberApiKeysFixture(m, api) {
  await organizationFixture(m, api)
  if (m.memberKeysFixture?.complete) return
  const id = (label) =>
    `c${createHash('sha256').update(`${m.uuid}:${label}`).digest('hex').slice(0, 24)}`
  const people = [
    ['empty', 'No integrations', 0],
    ['exports', 'Export manager', 3],
    ['automation', 'Automation manager', 25],
    ['large', 'Large integration set', 1001],
  ]
  for (const [label, name, count] of people) {
    const user = id(`user:${label}`)
    const member = id(`member:${label}`)
    await sql(
      m,
      `
      INSERT INTO core.users (id,email,"emailCanonical",name,"updatedAt")
      SELECT :'user',:'email',:'email',:'name',now() WHERE NOT EXISTS (SELECT 1 FROM core.users WHERE id=:'user');
      INSERT INTO core.org_members (id,"userId","organizationId")
      SELECT :'member',:'user',:'org' WHERE NOT EXISTS (SELECT 1 FROM core.org_members WHERE id=:'member');
      INSERT INTO core.member_roles (id,"memberId","roleId")
      SELECT :'link',:'member',id FROM core.roles WHERE name='MEMBER' AND "isSystem"=true
      AND NOT EXISTS (SELECT 1 FROM core.member_roles WHERE id=:'link');`,
      {
        user,
        member,
        org: m.organization.id,
        email: `${label}-${m.uuid}@preview.amcore.test`,
        name,
        link: id(`role:${label}`),
      }
    )
    // Fixed bounded fixture cardinality, not an HTTP revoke loop or an operator recovery writer.
    if (count)
      await sql(
        m,
        `
      INSERT INTO core.api_keys (id,name,"shortToken","keyHash",salt,scopes,"userId","organizationId","expiresAt")
      SELECT 'c'||substr(md5(:'prefix'||n::text),1,24), 'Sample integration '||n,
        :'prefix'||n::text, 'preview-not-an-authenticating-verifier', 'preview-salt',
        ARRAY['read:Organization'], :'user', :'org',
        NULL::timestamp
      FROM generate_series(1, ${count}) n
      WHERE NOT EXISTS (SELECT 1 FROM core.api_keys k WHERE k.id='c'||substr(md5(:'prefix'||n::text),1,24));
      UPDATE core.api_keys SET "expiresAt"=now()-interval '1 day'
      WHERE "shortToken"=:'prefix'||'2' AND "expiresAt" IS NULL AND "revokedAt" IS NULL;`,
        { prefix: id(`keys:${label}`), user, org: m.organization.id }
      )
  }
  m.memberKeysFixture = { complete: true, organizationId: m.organization.id }
  await save(m)
}
