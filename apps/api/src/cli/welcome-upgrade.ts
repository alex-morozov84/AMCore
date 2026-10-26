/* oxlint-disable no-console -- bounded operator manifest, no payload or connection details */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { PrismaPg } from '@prisma/adapter-pg'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { Pool } from 'pg'
import { z } from 'zod'

import { PrismaClient } from '../generated/prisma/client.js'
import { controlConnectionOptions } from '../infrastructure/background-work/control-connection.js'
import { upgradeWelcomeJob } from '../infrastructure/email/upgrade-welcome-job.js'
import { welcomeUpgradeInventory } from '../infrastructure/email/welcome-upgrade-inventory.js'
import { buildBullConnection } from '../infrastructure/queue/redis-connection.config.js'

import { organizationSetupEnvironment } from './organization-setup-input.js'

export async function runWelcomeUpgrade(
  args: string[],
  raw: Record<string, unknown>
): Promise<number> {
  const options = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      id: { type: 'string' },
      'queue-state': { type: 'string' },
      inventory: { type: 'boolean', default: false },
      cursor: { type: 'string', default: '0' },
      after: { type: 'string' },
      'skip-broker': { type: 'boolean', default: false },
      'skip-evidence': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      'mutators-stopped': { type: 'boolean', default: false },
    },
  }).values
  const id =
    options.inventory || options['queue-state']
      ? undefined
      : z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,128}$/)
          .parse(options.id)
  const cursor = z
    .string()
    .regex(/^[0-9]{1,20}$/)
    .parse(options.cursor)
  const after = z.uuidv7().optional().parse(options.after)
  const queueState = z.enum(['paused', 'running']).optional().parse(options['queue-state'])
  if (
    ((options.inventory || queueState) && (options.id || options.apply)) ||
    (options.inventory && queueState) ||
    (!options.inventory && (options['skip-broker'] || options['skip-evidence']))
  )
    throw new Error('INVALID_INPUT')
  if (!options['mutators-stopped']) throw new Error('MAINTENANCE_REQUIRED')
  const env = organizationSetupEnvironment(raw)
  const redisUrl = z.string().url().parse(raw.REDIS_URL)
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 3000,
    query_timeout: 5000,
  })
  const db = new PrismaClient({ adapter: new PrismaPg(pool) })
  const client = new Redis(controlConnectionOptions(redisUrl))
  client.on('error', () => undefined)
  const queue = new Queue('email', { prefix: 'amcore', connection: buildBullConnection(redisUrl) })
  queue.on('error', () => undefined)
  try {
    await client.connect()
    if (queueState) {
      if (queueState === 'paused') await queue.pause()
      else await queue.resume()
      console.log(JSON.stringify({ queueState }))
      return 0
    }
    if (options.inventory) {
      console.log(
        JSON.stringify(
          await welcomeUpgradeInventory(client, db, queue, cursor, after, {
            broker: options['skip-broker'],
            evidence: options['skip-evidence'],
          })
        )
      )
      return 0
    }
    const result = await upgradeWelcomeJob(client, db, queue, id!, options.apply)
    console.log(JSON.stringify({ id, ...result }))
    return ['converted', 'already_v2', 'protected', 'eligible'].includes(result.status) ? 0 : 3
  } finally {
    client.disconnect(false)
    try {
      await queue.close()
    } finally {
      try {
        await db.$disconnect()
      } finally {
        await pool.end()
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  const deadline = setTimeout(() => {
    console.log(
      JSON.stringify({ status: 'unconfirmed', nextAction: 'retain-maintenance-and-inspect' })
    )
    process.exit(4)
  }, 20000)
  void runWelcomeUpgrade(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code
    })
    .catch(() => {
      console.log(
        JSON.stringify({ status: 'unconfirmed', nextAction: 'retain-maintenance-and-inspect' })
      )
      process.exitCode = 4
    })
    .finally(() => clearTimeout(deadline))
}
