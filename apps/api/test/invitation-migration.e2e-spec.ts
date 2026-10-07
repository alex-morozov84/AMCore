import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

/** Upgrade starts with the actual previous repository migration chain. */
describe('R17 invitation role-intent migration', () => {
  it('revokes only ambiguous nonterminal rows and frees pending unique slot', async () => {
    const container = await new PostgreSqlContainer('postgres:18-alpine').start()
    const pool = new Pool({ connectionString: container.getConnectionUri() })
    const directory = mkdtempSync(resolve(tmpdir(), 't028-migration-'))
    const migration = '20261003180000_invitation_role_intent'
    const settlement = '20261004190000_invitation_intent_and_settlement'
    try {
      cpSync(resolve('prisma'), resolve(directory, 'prisma'), {
        recursive: true,
        filter: (path) => !path.includes(migration) && !path.includes(settlement),
      })
      writeFileSync(
        resolve(directory, 'prisma.config.ts'),
        `import { defineConfig } from '${resolve('node_modules/prisma/config.js')}'\nexport default defineConfig({schema:'./prisma',datasource:{url:process.env.E2E_DATABASE_URL}})\n`
      )
      const deploy = () =>
        execFileSync(
          'pnpm',
          ['prisma', 'migrate', 'deploy', '--config', resolve(directory, 'prisma.config.ts')],
          { env: { ...process.env, E2E_DATABASE_URL: container.getConnectionUri() }, stdio: 'pipe' }
        )
      await pool.query(
        'CREATE SCHEMA core; CREATE SCHEMA fitness; CREATE SCHEMA finance; CREATE SCHEMA subscriptions'
      )
      deploy()
      expect(
        (await pool.query('SELECT migration_name FROM public._prisma_migrations')).rows.map(
          (r) => r.migration_name
        )
      ).not.toContain(migration)
      await pool.query(`INSERT INTO core.organizations (id,name,slug,"updatedAt") VALUES ('org','Upgrade','upgrade',TIMESTAMP '2026-01-01');
        INSERT INTO core.roles (id,name,"isSystem") VALUES ('member','MEMBER',true)`)
      const cases = ['pending', 'expired', 'accepted', 'revoked', 'concrete', 'concrete-accepted']
      for (const kind of cases) {
        await pool.query(
          `INSERT INTO core.org_invites (id,"organizationId",email,"emailCanonical","tokenHash","roleId","expiresAt","acceptedAt","revokedAt","updatedAt") VALUES ($1,'org',$2,$2,$1,$3,$4::timestamp,$5::timestamp,$6::timestamp,TIMESTAMP '2026-01-01')`,
          [
            kind,
            `${kind}@example.test`,
            kind.startsWith('concrete') ? 'member' : null,
            kind === 'expired' ? '2020-01-01' : '2099-01-01',
            kind.includes('accepted') ? '2026-01-02' : null,
            kind === 'revoked' ? '2026-01-02' : null,
          ]
        )
      }
      const before = (await pool.query('SELECT * FROM core.org_invites ORDER BY id')).rows
      cpSync(
        resolve('prisma/migrations', migration),
        resolve(directory, 'prisma/migrations', migration),
        { recursive: true }
      )
      deploy()
      const after = (await pool.query('SELECT * FROM core.org_invites ORDER BY id')).rows
      const ambiguous = after.filter((row) => ['pending', 'expired'].includes(row.id))
      for (const row of ambiguous) {
        const old = before.find((r) => r.id === row.id)
        expect(row.revokedAt).toBeInstanceOf(Date)
        expect(row.updatedAt).toEqual(row.revokedAt)
        expect(row.revokedById).toBeNull()
        expect({ ...row, revokedAt: old.revokedAt, updatedAt: old.updatedAt }).toEqual(old)
      }
      expect(after.filter((row) => !['pending', 'expired'].includes(row.id))).toEqual(
        before.filter((row) => !['pending', 'expired'].includes(row.id))
      )
      await pool.query(
        `INSERT INTO core.org_invites (id,"organizationId",email,"emailCanonical","tokenHash","roleId","expiresAt","updatedAt") VALUES ('replacement','org','pending@example.test','pending@example.test','replacement','member',TIMESTAMP '2099-01-01',CURRENT_TIMESTAMP)`
      )
      expect(
        (
          await pool.query(
            'SELECT migration_name FROM public._prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL',
            [migration]
          )
        ).rowCount
      ).toBe(1)
      const preserved = (await pool.query('SELECT * FROM core.org_invites ORDER BY id')).rows
      cpSync(
        resolve('prisma/migrations', settlement),
        resolve(directory, 'prisma/migrations', settlement),
        { recursive: true }
      )
      deploy()
      const upgraded = (await pool.query('SELECT * FROM core.org_invites ORDER BY id')).rows
      for (const row of upgraded) {
        const old = preserved.find((r) => r.id === row.id)
        const { generation, issuedAt, issuedAtEstimated, intentInvalid, ...remaining } = row
        const { roleId, ...oldRemaining } = old
        expect(remaining).toEqual(oldRemaining)
        expect(generation).toBe(1)
        expect(issuedAt).toEqual(old.createdAt)
        expect(issuedAtEstimated).toBe(true)
        expect(intentInvalid).toBe(roleId === null)
        const roles = (
          await pool.query('SELECT * FROM core.org_invite_role_intents WHERE "inviteId"=$1', [
            row.id,
          ])
        ).rows
        const expectedRole = expect.objectContaining({
          ordinal: 0,
          requestedRoleId: roleId,
          liveRoleId: roleId,
          roleNameAtIssue: 'MEMBER',
        })
        expect(roles).toEqual(roleId ? [expectedRole] : [])
      }
      await pool.query("DELETE FROM core.roles WHERE id='member'")
      const deleted = (await pool.query('SELECT * FROM core.org_invite_role_intents')).rows
      expect(deleted.length).toBeGreaterThan(0)
      expect(
        deleted.every(
          (r) =>
            r.requestedRoleId === 'member' &&
            r.liveRoleId === null &&
            r.roleNameAtIssue === 'MEMBER'
        )
      ).toBe(true)
    } finally {
      await pool.end()
      await container.stop()
    }
  }, 120000)
})
