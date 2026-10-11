import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

import { e2eContainerLabels } from './e2e-owned-containers'

const upgrade = '20261011170000_notification_delivery_control'
const migrations = join(process.cwd(), 'prisma/migrations')

describe('Notification control historical maintenance upgrade', () => {
  let container: StartedPostgreSqlContainer
  let client: Client
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    client = new Client({
      connectionString: container.getConnectionUri(),
      application_name: 'amcore-t042-migrator',
    })
    await client.connect()
    await client.query('CREATE SCHEMA fitness; CREATE SCHEMA finance; CREATE SCHEMA subscriptions;')
    for (const name of readdirSync(migrations)
      .filter((name) => /^\d/.test(name) && name < upgrade)
      .sort())
      await client.query(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
    await client.query(
      readFileSync(
        join(process.cwd(), 'test/fixtures/extension-contracts/legacy-notifications.sql'),
        'utf8'
      )
    )
    await client.query(`UPDATE notifications.notification_deliveries SET "requestContractVersion" = 1,
      "preparedRequest" = '{"body":"frozen historical bytes"}', "preparedRequestHash" = repeat('a',64)
      WHERE id IN ('processing', 'delivered', 'never');`)
  }, 120000)
  afterAll(async () => {
    await client?.end()
    await container?.stop()
  }, 60000)

  it('refuses old writers, seeds the singleton and preserves historical bytes with conservative certainty', async () => {
    const migration = readFileSync(join(migrations, upgrade, 'migration.sql'), 'utf8')
    const writer = new Client({
      connectionString: container.getConnectionUri(),
      application_name: 'amcore-worker',
    })
    await writer.connect()
    try {
      await expect(client.query(migration)).rejects.toThrow(
        'notification_control_old_writers_connected'
      )
      await client.query('ROLLBACK')
      expect(
        (
          await client.query(
            `SELECT to_regclass('notifications.notification_delivery_control') AS name`
          )
        ).rows[0].name
      ).toBeNull()
    } finally {
      await writer.end()
    }
    await client.query(migration)
    expect(
      (
        await client.query(
          'SELECT id, paused, revision FROM notifications.notification_delivery_control'
        )
      ).rows
    ).toEqual([{ id: 1, paused: false, revision: 0 }])
    const rows = (
      await client.query('SELECT * FROM notifications.notification_deliveries ORDER BY id')
    ).rows
    expect(new Set(rows.map((row) => row.incarnation)).size).toBe(rows.length)
    expect(
      rows.every(
        (row) =>
          row.manualGrant === 'none' && row.controlRevision === 0 && row.historyPrunedThrough === 0
      )
    ).toBe(true)
    for (const id of [
      'reaped',
      'zero-with-attempt',
      'processing',
      'retry',
      'receipt',
      'delivered',
      'failed',
      'cancelled',
    ]) {
      expect(rows.find((row) => row.id === id)).toMatchObject({
        legacyUnverified: true,
        unresolvedEffectCount: 1,
      })
    }
    for (const id of ['never', 'in-app', 'skipped'])
      expect(rows.find((row) => row.id === id)).toMatchObject({
        legacyUnverified: false,
        unresolvedEffectCount: 0,
      })
    expect(rows.find((row) => row.id === 'delivered').acceptedSeen).toBe(true)
    for (const id of ['processing', 'delivered', 'never'])
      expect(rows.find((row) => row.id === id)).toMatchObject({
        preparedRequest: { body: 'frozen historical bytes' },
        preparedRequestHash: 'a'.repeat(64),
        requestContractVersion: 1,
      })
    expect(rows.find((row) => row.id === 'processing')).toMatchObject({
      status: 'PROCESSING',
      leaseToken: 'legacy-lease',
      attemptCount: 1,
    })
    const attempts = (
      await client.query('SELECT * FROM notifications.notification_delivery_attempts')
    ).rows
    expect(attempts).toHaveLength(3)
    expect(attempts.every((row) => row.effectState === 'unknown')).toBe(true)
    expect(attempts.find((row) => row.id === 'old-attempt-reaped').outcome).toBe('ABANDONED')
    expect(
      rows
        .filter((row) => ['DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(row.status))
        .every((row) => row.terminalAt)
    ).toBe(true)
  })
})
