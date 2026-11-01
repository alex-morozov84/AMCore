import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

import {
  activeEnvironment,
  environmentExceptions,
  targetServices,
  composeEnvironment,
} from './compose-env-fixture.mjs'

const omittedBefore = [
  'DATABASE_POOL_IDLE_MS',
  'DATABASE_CONNECT_MS',
  'DATABASE_STATEMENT_TIMEOUT_MS',
  'DATABASE_QUERY_TIMEOUT_MS',
  'LOG_BODY_MAX_BYTES',
  'JWT_ACCESS_EXPIRATION',
  'JWT_REFRESH_DAYS',
  'STEP_UP_MAX_AGE_SECONDS',
  'CORS_ORIGIN',
  'PASSWORD_RESET_EXPIRY_MINUTES',
  'EMAIL_VERIFICATION_EXPIRY_HOURS',
  'MEDIA_MAX_SOURCE_BYTES',
  'MEDIA_MAX_WIDTH',
  'MEDIA_MAX_HEIGHT',
  'MEDIA_MAX_PIXELS',
  'MEDIA_SHARP_LIMIT_INPUT_PIXELS',
  'MEDIA_AVATAR_MAX_PIXELS',
  'MEDIA_AVATAR_CACHE_CONTROL',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'YANDEX_API_KEY',
  'AI_OPENAI_COMPATIBLE_API_KEY',
  'AI_REQUEST_TIMEOUT_MS',
  'AI_CATALOG_CACHE_TTL_SECONDS',
  'AI_GUARDRAIL_INPUT_MODE',
  'AI_GUARDRAIL_MAX_INPUT_CHARS',
  'AI_TOOL_LOOP_MAX_STEPS',
  'AI_TOOL_EXECUTION_TIMEOUT_MS',
  'AI_APPROVAL_TTL_MS',
  'AI_RUN_DEADLINE_MS',
  'AI_ARTIFACT_MAX_IMAGE_BYTES',
  'AI_ARTIFACT_MAX_DOCUMENT_BYTES',
  'AI_ARTIFACT_MAX_PARTS_PER_MESSAGE',
]

const sentinels = Object.fromEntries(
  Object.keys(activeEnvironment).map((key) => [
    key,
    Object.hasOwn(environmentExceptions, key) ? activeEnvironment[key] : `synthetic-${key}`,
  ])
)
// Numeric sentinel still proves that a native port override cannot retarget the container.
sentinels.API_PORT = '5999'
sentinels.COMPOSE_PROFILES = 'local-infra'
sentinels.DATABASE_URL = 'postgresql://native.example.test/native'
sentinels.REDIS_URL = 'redis://native.example.test:6379'
sentinels.COMPOSE_DATABASE_URL = 'postgresql://container.example.test/app'
sentinels.COMPOSE_REDIS_URL = 'redis://container.example.test:6379'

function assertForwarding(config) {
  for (const key of Object.keys(activeEnvironment)) {
    if (Object.hasOwn(environmentExceptions, key)) continue
    for (const service of targetServices(key)) {
      assert.equal(config.services[service].environment[key], sentinels[key], `${service}/${key}`)
    }
  }
  for (const service of ['api', 'worker', 'web']) {
    const env = config.services[service].environment
    assert.equal(env.REDIS_URL, sentinels.COMPOSE_REDIS_URL)
    assert.equal(env.COMPOSE_PROFILES, undefined)
  }
  for (const service of ['api', 'worker']) {
    assert.equal(config.services[service].environment.DATABASE_URL, sentinels.COMPOSE_DATABASE_URL)
    assert.equal(config.services[service].environment.API_PORT, '5002')
  }
}

const fakeDigest = `registry.example.test/image@sha256:${'a'.repeat(64)}`
for (const [name, files, extra] of [
  ['base', [], {}],
  [
    'registry',
    ['docker/compose/prod.yml'],
    {
      COMPOSE_API_IMAGE: fakeDigest,
      COMPOSE_WEB_IMAGE: fakeDigest,
      COMPOSE_API_MIGRATOR_IMAGE: fakeDigest,
    },
  ],
  ['web edge', ['docker/compose/web.yml'], { CADDY_WEB_DOMAIN: 'web.example.test' }],
  ['staff edge', ['docker/compose/product-admin-host.yml'], {}],
])
  test(`${name}: every active runtime setting reaches its owning services`, () => {
    assertForwarding(
      composeEnvironment({ ...sentinels, ...extra }, ['docker-compose.yml', ...files])
    )
  })

const hostOverlay = new URL('../../docker/compose/console-host.yml', import.meta.url)
if (existsSync(hostOverlay))
  test('host edge: required topology inputs preserve runtime forwarding', () => {
    const required = [...readFileSync(hostOverlay, 'utf8').matchAll(/\$\{([A-Z_]+):\?/g)]
    const values = Object.fromEntries(required.map(([, key]) => [key, 'host.example.test']))
    assertForwarding(
      composeEnvironment({ ...sentinels, ...values }, [
        'docker-compose.yml',
        'docker/compose/console-host.yml',
      ])
    )
  })

test('the repaired settings retain the documented defaults with an empty env file', () => {
  const config = composeEnvironment()
  assert.equal(omittedBefore.length, 34)
  for (const key of omittedBefore) {
    if (!Object.hasOwn(activeEnvironment, key)) continue // variable not present in this stand profile
    for (const service of ['api', 'worker']) {
      assert.equal(
        config.services[service].environment[key],
        activeEnvironment[key],
        `${service}/${key}`
      )
    }
  }
  assert.equal(config.services.api.environment.STORAGE_LOCAL_ROOT, '/app/uploads')
})

test('backend configuration and secrets do not spill into web or one-shot images', () => {
  const config = composeEnvironment(sentinels)
  for (const key of Object.keys(activeEnvironment)) {
    if (Object.hasOwn(environmentExceptions, key) || key === 'NODE_ENV') continue
    const targets = targetServices(key)
    for (const service of ['web', 'migrate', 'system-seed']) {
      if (!targets.includes(service))
        assert.equal(config.services[service].environment[key], undefined, `${service}/${key}`)
    }
  }
})

test('explicit MFA overlay supplies keys only to API/worker and never activates the protocol', () => {
  const keyId = 'fixture-current'
  const keys = JSON.stringify({ [keyId]: Buffer.alloc(32, 7).toString('base64') })
  const config = composeEnvironment(
    { ...sentinels, MFA_ACTIVE_KEY_ID: keyId, MFA_ENCRYPTION_KEYS: keys },
    ['docker-compose.yml', 'docker/compose/mfa.yml']
  )
  for (const name of ['api', 'worker']) {
    assert.equal(config.services[name].environment.MFA_ACTIVE_KEY_ID, keyId)
    assert.equal(config.services[name].environment.MFA_ENCRYPTION_KEYS, keys)
  }
  assert.equal(config.services.web.environment.MFA_ENCRYPTION_KEYS, undefined)
  assert.equal(config.services['system-seed'].environment.MFA_ENCRYPTION_KEYS, undefined)
  assert.equal(config.services.api.environment.MFA_ENABLED, undefined)
})
