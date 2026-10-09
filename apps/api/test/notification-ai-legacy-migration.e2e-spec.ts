import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client, types } from 'pg'

const upgrade = '20261008160000_notification_ai_extension_contracts'
const migrations = join(process.cwd(), 'prisma/migrations')
const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'test/fixtures/extension-contracts', name), 'utf8')

/** Execute exact historical SQL before the upgrade; never connect an application to this old schema. */
describe('Extension legacy maintenance migration (PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer
  let client: Client
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
    client = new Client({
      connectionString: container.getConnectionUri(),
      application_name: 'amcore-t039-migrator',
      types: {
        getTypeParser: (oid: number, format?: 'text' | 'binary') =>
          oid === 1114
            ? (value: string) => new Date(value.replace(' ', 'T') + 'Z')
            : types.getTypeParser(oid, format),
      },
    })
    await client.connect()
    await client.query('CREATE SCHEMA fitness; CREATE SCHEMA finance; CREATE SCHEMA subscriptions;')
    for (const name of readdirSync(migrations)
      .filter((name) => /^\d/.test(name) && name < upgrade)
      .sort()) {
      await client.query(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
    }
    await client.query(fixture('legacy-notifications.sql'))
    await client.query(fixture('legacy-tools.sql'))
  }, 120000)
  afterAll(async () => {
    await client?.end()
    await container?.stop()
  }, 120000)

  it('refuses live old writers, then conservatively converts work while preserving evidence', async () => {
    const sql = readFileSync(join(migrations, upgrade, 'migration.sql'), 'utf8')
    const writer = new Client({
      connectionString: container.getConnectionUri(),
      application_name: 'amcore-worker',
    })
    await writer.connect()
    try {
      await expect(client.query(sql)).rejects.toThrow(
        'extension_contract_migration_old_writers_connected'
      )
      await client.query('ROLLBACK')
    } finally {
      await writer.end()
    }
    await client.query(sql)
    const deliveries = (
      await client.query('SELECT * FROM notifications.notification_deliveries ORDER BY id')
    ).rows
    const byId = (id: string) => deliveries.find((row) => row.id === id)
    expect(byId('never')).toMatchObject({
      status: 'PENDING',
      requestContractVersion: 1,
      attemptCount: 0,
    })
    for (const id of ['reaped', 'zero-with-attempt', 'processing', 'retry', 'receipt']) {
      expect(byId(id)).toMatchObject({
        status: 'FAILED',
        requestContractVersion: null,
        terminalReasonCode: 'legacy_request_unavailable',
        lastErrorCode: 'legacy_delivery_outcome_unverified',
        leaseToken: null,
        leaseExpiresAt: null,
        preparedRequest: null,
      })
    }
    expect(byId('reaped').attemptCount).toBe(1)
    expect(byId('retry').nextAttemptAt.toISOString()).toBe('2099-01-01T00:00:00.000Z')
    expect(byId('receipt').providerMessageId).toBe('retained-receipt')
    for (const [id, status] of [
      ['delivered', 'DELIVERED'],
      ['failed', 'FAILED'],
      ['skipped', 'SKIPPED'],
      ['cancelled', 'CANCELLED'],
      ['in-app', 'DELIVERED'],
    ] as const) {
      expect(byId(id)).toMatchObject({ status, requestContractVersion: null })
    }
    const attempts = (
      await client.query('SELECT * FROM notifications.notification_delivery_attempts ORDER BY id')
    ).rows
    expect(
      attempts
        .filter((row) => row.id !== 'old-attempt-reaped')
        .every((row) => row.outcome === 'ABANDONED' && row.finishedAt)
    ).toBe(true)
    expect(attempts.find((row) => row.id === 'old-attempt-reaped').finishedAt.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z'
    )
    const runs = (await client.query('SELECT * FROM ai.ai_runs')).rows
    for (const id of ['executing', 'started-but-requested', 'unknown']) {
      expect(runs.find((row) => row.id === id)).toMatchObject({
        status: 'FAILED',
        terminalReasonCode: 'tool_effect_unknown',
      })
    }
    expect(runs.find((row) => row.id === 'success-unapplied')).toMatchObject({
      status: 'FAILED',
      terminalReasonCode: 'tool_state_inconsistent',
    })
    for (const id of ['unstarted', 'approved', 'read-only']) {
      expect(runs.find((row) => row.id === id)).toMatchObject({
        status: 'FAILED',
        terminalReasonCode: 'tool_schema_incompatible',
      })
    }
    expect(runs.find((row) => row.id === 'terminal').status).toBe('COMPLETED')
    const tools = (await client.query('SELECT * FROM ai.ai_tool_invocations')).rows
    expect(tools.find((row) => row.id === 'success-inv')).toMatchObject({
      status: 'SUCCEEDED',
      appliedAt: null,
      intentHash: null,
    })
    expect(tools.find((row) => row.id === 'started-inv').status).toBe('OUTCOME_UNKNOWN')
    const gates = (await client.query('SELECT * FROM ai.ai_approvals')).rows
    expect(gates.find((row) => row.id === 'pending').state).toBe('EXPIRED')
    expect(gates.find((row) => row.id === 'human-approved')).toMatchObject({
      state: 'APPROVED',
      decidedById: 'legacy-owner',
    })
    expect(gates.find((row) => row.id === 'human-rejected').state).toBe('REJECTED')
    const audit = (
      await client.query("SELECT * FROM core.audit_log WHERE action = 'ai.approval.expired'")
    ).rows
    expect(audit).toHaveLength(1)
    expect(audit[0].metadata).toMatchObject({
      reasonCode: 'legacy_contract_expired',
      approvalId: 'pending',
    })
    const history = (await client.query('SELECT * FROM ai.ai_run_attempts')).rows
    expect(history.every((row) => row.endedAt !== null)).toBe(true)
  })
})
