import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { clearTimeout } from 'node:timers'
import { test } from 'node:test'
import { parse } from 'yaml'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const base = parse(read('docker-compose.yml'))
const probe = base.services.web.healthcheck
const command = probe.test[3].replaceAll('$$', '$')

// Execute the shipped command with controlled I/O; never occupy the owner's port 3000.
function execute(fetch, schedule = setTimeout) {
  return new Promise((resolve, reject) => {
    let timer
    const finish = (code) => {
      clearTimeout(timer)
      resolve(code)
    }
    try {
      runInNewContext(command, {
        fetch,
        AbortSignal: globalThis.AbortSignal,
        setTimeout: (callback, delay) => {
          timer = schedule(callback, delay)
        },
        process: { exit: finish },
      })
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })
}

const response = (status, data) => async () => ({ status, json: async () => data })

test('web readiness accepts only the expected local route and version response', async () => {
  assert.deepEqual(probe.test.slice(0, 3), ['CMD', 'node', '-e'])
  assert.equal(
    await execute(async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:3000/api/deployment-version')
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof globalThis.AbortSignal)
      return { status: 200, json: async () => ({ version: 'build-123.test' }) }
    }),
    0
  )
})

for (const [name, fetch] of [
  ['404', response(404, { version: 'build' })],
  ['503', response(503, { version: 'build' })],
  ['redirect', response(302, { version: 'build' })],
  ['missing version', response(200, {})],
  ['empty version', response(200, { version: '' })],
  ['oversized version', response(200, { version: 'a'.repeat(129) })],
  ['invalid version', response(200, { version: 'space here' })],
  ['wrong version type', response(200, { version: 123 })],
  ['null body', response(200, null)],
  [
    'bad JSON',
    async () => ({
      status: 200,
      json: async () => {
        throw new SyntaxError()
      },
    }),
  ],
  [
    'connection refused',
    async () => {
      throw new Error('refused')
    },
  ],
])
  test(`web readiness refuses ${name}`, async () => assert.equal(await execute(fetch), 1))

for (const [name, fetch] of [
  ['connection', () => new Promise(() => {})],
  ['body', async () => ({ status: 200, json: () => new Promise(() => {}) })],
])
  test(`internal deadline bounds a stalled ${name}`, async () => {
    let deadline
    const result = execute(fetch, (callback, delay) => {
      deadline = { callback, delay }
    })
    assert.equal(deadline.delay, 3000)
    deadline.callback()
    assert.equal(await result, 1)
  })

test('Docker timeout remains the outer bound, including a blocked Node event loop', () => {
  assert.equal(probe.timeout, '5s')
  assert.equal(probe.interval, '10s')
  assert.equal(probe.start_period, '30s')
  assert.equal(probe.retries, 3)
})

test('web-facing overlays wait for web; the default API edge stays independent', () => {
  assert.equal(base.services.caddy.depends_on.web, undefined)
  for (const path of ['web', 'console-host', 'product-admin-host']) {
    const file = `docker/compose/${path}.yml`
    if (path === 'console-host' && !existsSync(new URL(`../../${file}`, import.meta.url))) continue
    const edge = parse(read(file)).services.caddy.depends_on
    assert.equal(edge.web.condition, 'service_healthy', file)
    assert.equal(edge.api.condition, 'service_healthy', file)
  }
})
