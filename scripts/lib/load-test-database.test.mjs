import assert from 'node:assert/strict'
import { test } from 'node:test'
import { databaseProblem, CA } from '../load-test/database-check.mjs'
import { checkOverride } from '../load-test/override-check.mjs'

const reference = new URL(
  `postgresql://m:x@postgres:5432/amcore?sslmode=verify-full&sslrootcert=${CA}`
)
const definition = () => ({
  environment: {
    DATABASE_URL: `postgresql://m:x@postgres:5432/amcore?sslmode=require&sslaccept=strict&sslcert=${CA}`,
  },
  volumes: [{ type: 'bind', source: '/private/ca', target: '/etc/amcore/db-ca', read_only: true }],
})

test('native TLS requires exact client settings, endpoint, CA mount and migrator identity', () => {
  assert.equal(databaseProblem('migrate', 'DATABASE_URL', definition(), reference), undefined)
  for (const change of [
    (d) => {
      d.environment.DATABASE_URL += '&host=foreign'
    },
    (d) => {
      d.environment.DATABASE_URL += '&port=6432'
    },
    (d) => {
      d.environment.DATABASE_URL += '&sslmode=disable'
    },
    (d) => {
      d.environment.DATABASE_URL = d.environment.DATABASE_URL.replace(
        'strict',
        'accept_invalid_certs'
      )
    },
    (d) => {
      d.environment.DATABASE_URL = d.environment.DATABASE_URL.replace(
        'postgres:5432',
        'foreign:5432'
      )
    },
    (d) => {
      d.environment.DATABASE_URL = d.environment.DATABASE_URL.replace('/amcore?', '/foreign?')
    },
    (d) => {
      d.environment.DATABASE_URL = d.environment.DATABASE_URL.replace('m:x', 'm:other')
    },
    (d) => {
      d.environment.E2E_DATABASE_URL = reference.href
    },
    (d) => {
      d.volumes[0].read_only = false
    },
  ]) {
    const d = definition()
    change(d)
    assert.ok(databaseProblem('migrate', 'DATABASE_URL', d, reference))
  }
})

test('private override changes only native URL; foreign services/mounts/commands refused', () => {
  const base = { services: { migrate: definition(), api: { image: 'api' } } }
  const good = globalThis.structuredClone(base)
  good.services.migrate.environment.DATABASE_URL = 'different'
  assert.equal(checkOverride(base, good), true)
  for (const change of [
    (d) => {
      d.services.api.image = 'foreign'
    },
    (d) => {
      d.services.migrate.command = ['other']
    },
    (d) => {
      d.services.migrate.volumes[0].source = '/other'
    },
    (d) => {
      d.services.migrate.environment.E2E_DATABASE_URL = 'other'
    },
  ]) {
    const bad = globalThis.structuredClone(good)
    change(bad)
    assert.equal(checkOverride(base, bad), false)
  }
})
