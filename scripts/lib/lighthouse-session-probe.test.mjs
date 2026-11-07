import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { sessionProbe, boundDocument } from '../lighthouse/session-probe.mjs'
import { acceptanceTarget, documentRefusal } from '../stand/lighthouse-acceptance.mjs'
import BFCacheFailures from 'lighthouse/core/gather/gatherers/bf-cache-failures.js'
import { initializeConfig } from 'lighthouse/core/config/config.js'
import { measuredErrorKind, watchMeasuredPage, bfCacheConfig } from '../lighthouse/page-state.mjs'
import { digest } from './lighthouse-plan.mjs'

const url = 'https://owned.localhost/en/organizations/example/members'
const subject = 'fixture-subject'
function fixture(audience = 'product', overrides = {}) {
  let cookies = [
    {
      name: audience === 'product' ? 'amcore_session' : `__Host-amcore_${audience}_session`,
      value: 'fake-session',
      domain: 'owned.localhost',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]
  const binding = digest(JSON.stringify(['product-context-v2', audience, 'fake-session', subject]))
  const calls = []
  let disposed = 0
  const context = {
    cookies: async () => cookies,
    request: {
      get: async (target, options) => {
        calls.push({ target, options })
        if (overrides.throw) throw new Error('fixture timeout')
        if (overrides.cookies) cookies = overrides.cookies(cookies)
        return {
          status: () => overrides.status ?? (target.endsWith('/access') ? 204 : 200),
          json: async () => overrides.body ?? { user: { id: subject } },
          headers: () => ({ 'x-amcore-context-session': overrides.fence ?? binding }),
          dispose: async () => {
            disposed++
          },
        }
      },
    },
  }
  return { context, binding, calls, disposed: () => disposed }
}

test('each audience uses the correct cookie and bounded Node transport, without page calls', async () => {
  for (const audience of ['product', 'staff', 'console']) {
    const f = fixture(audience)
    assert.equal(
      await sessionProbe(
        f.context,
        url,
        subject,
        audience,
        audience === 'console' ? '/api/access' : undefined
      ),
      f.binding
    )
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.calls[0].options, { maxRedirects: 0, timeout: 5000 })
    assert.equal(
      new URL(f.calls[0].target).pathname,
      audience === 'console' ? '/api/access' : '/api/auth/me'
    )
    assert.equal(f.disposed(), 1)
  }
})

test('only the external anonymous probe accepts 401 without a user', async () => {
  const f = fixture('product', { status: 401, body: {} })
  assert.equal(await sessionProbe(f.context, url), undefined)
  for (const overrides of [{ status: 200 }, { status: 302, body: {} }, { status: 401 }])
    await assert.rejects(
      sessionProbe(fixture('product', overrides).context, url),
      /measured-subject-refused/
    )
})

test('authenticated redirects, refusal, wrong subject, missing or wrong fence and timeout fail', async () => {
  for (const overrides of [
    { status: 307 },
    { status: 401 },
    { status: 403 },
    { status: 429 },
    { body: { user: { id: 'other' } } },
    { body: {} },
    { fence: '' },
    { fence: 'wrong' },
    { throw: true },
  ]) {
    const f = fixture('product', overrides)
    await assert.rejects(sessionProbe(f.context, url, subject))
    assert.equal(f.disposed(), overrides.throw ? 0 : 1)
  }
  await assert.rejects(
    sessionProbe(
      fixture('console', { status: 401 }).context,
      url,
      subject,
      'console',
      '/api/access'
    ),
    /console-audience-refused/
  )
})

test('cookie clearing, replacement, added auth cookie or changed scope fail; expiry metadata is irrelevant', async () => {
  for (const change of [
    () => [],
    (cookies) => [{ ...cookies[0], value: 'replacement' }],
    (cookies) => [...cookies, { ...cookies[0], name: '__Host-amcore_staff_session' }],
    (cookies) => [{ ...cookies[0], path: '/other' }],
  ])
    await assert.rejects(
      sessionProbe(fixture('product', { cookies: change }).context, url, subject),
      /measured-session-cookie-changed/
    )
  const f = fixture('product', { cookies: (cookies) => [{ ...cookies[0], expires: 12345 }] })
  assert.equal(await sessionProbe(f.context, url, subject), f.binding)
})

test('document binding refuses a wrong document and a replacement document, independent of successful probes', async () => {
  const f = fixture()
  await sessionProbe(f.context, url, subject)
  const original = { documentElement: { outerHTML: f.binding } }
  const previous = globalThis.document
  globalThis.document = original
  const handle = { evaluate: async (read, expected) => read(original, expected) }
  try {
    await boundDocument(handle, f.binding)
    await assert.rejects(boundDocument(handle, 'other-binding'), /measured-session-fence-missing/)
    globalThis.document = { documentElement: { outerHTML: f.binding } }
    await assert.rejects(boundDocument(handle, f.binding), /measured-session-fence-missing/)
    await sessionProbe(f.context, url, subject)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

test('page-originated 401, 403, 429 and transport failures remain visible for anonymous login', async () => {
  for (const status of [401, 403, 429]) {
    const page = new EventEmitter()
    const watch = watchMeasuredPage(page, 'https://owned.localhost', true)
    page.emit('response', {
      url: () => 'https://owned.localhost/api/auth/me',
      status: () => status,
    })
    await assert.rejects(watch.assert(), /required-data-/)
    watch.close()
    assert.equal(page.listenerCount('response'), 0)
  }
  const page = new EventEmitter()
  const watch = watchMeasuredPage(page, 'https://owned.localhost', true)
  page.emit('requestfailed', { url: () => 'https://owned.localhost/api/auth/me' })
  await assert.rejects(watch.assert(), /required-data-transport/)
  watch.close()
})

test('real response Set-Cookie is refused and an actual stalled Node probe times out', async () => {
  const require = createRequire(new URL('../../apps/web/package.json', import.meta.url))
  const { request } = require('@playwright/test')
  const server = createServer((req, res) => {
    if (req.headers.cookie?.includes('fake-session')) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'amcore_session=replacement; Path=/; HttpOnly; SameSite=Strict',
      })
      res.end(JSON.stringify({ user: { id: subject } }))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const api = await request.newContext({
    storageState: {
      cookies: [
        {
          name: 'amcore_session',
          value: 'fake-session',
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          secure: false,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ],
      origins: [],
    },
  })
  const empty = await request.newContext()
  try {
    const context = (client) => ({
      request: client,
      cookies: async () => (await client.storageState()).cookies,
    })
    await assert.rejects(
      sessionProbe(context(api), origin, subject),
      /measured-session-cookie-changed/
    )
    const start = Date.now()
    await assert.rejects(sessionProbe(context(empty), origin), /Timeout.*5000ms/)
    assert.ok(Date.now() - start < 6500)
  } finally {
    await api.dispose()
    await empty.dispose()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('acceptance dispatch uses assigned successful positives and Console-specific topology', () => {
  const success = (id) => ({ id, valid: true, policy: { passed: true } })
  const all = ['login', 'members', 'console-overview']
  const failed = [success('login'), { id: 'members', valid: false }, success('console-overview')]
  assert.deepEqual(acceptanceTarget(all, failed, 'path'), { reason: 'required-positive-failed' })
  for (const topology of ['path', 'host'])
    assert.deepEqual(acceptanceTarget(['members'], [success('members')], topology), {
      scenario: 'members',
    })
  assert.deepEqual(acceptanceTarget(['console-overview'], [success('console-overview')], 'host'), {
    scenario: 'console-overview',
  })
  assert.deepEqual(acceptanceTarget(['console-overview'], [success('console-overview')], 'path'), {
    reason: 'acceptance-target-unavailable',
  })
  for (const results of [
    [],
    [{ id: 'members', valid: false }],
    [{ id: 'members', valid: true, policy: { passed: false } }],
  ])
    assert.deepEqual(acceptanceTarget(['members'], results, 'path'), {
      reason: 'required-positive-failed',
    })
  assert.deepEqual(acceptanceTarget(['login'], [success('login'), success('members')], 'path'), {
    reason: 'acceptance-target-unavailable',
  })
})

test('safe error categories never export exception text or secrets', () => {
  for (const [text, category] of [
    ['Timeout 10000ms; cookie=fake-private', 'timeout'],
    ['Execution context was destroyed; token=fake-private', 'context-destroyed'],
    ['Cannot find context with specified id; fake-private', 'context-destroyed'],
    ['JSHandle is disposed; fake-private', 'handle-disposed'],
    ['Target page, context or browser has been closed; fake-private', 'target-closed'],
    ['Unexpected DOM fake-private', 'other'],
  ]) {
    assert.equal(measuredErrorKind(new Error(text)), category)
    assert.equal(measuredErrorKind(new Error(text)).includes('fake-private'), false)
  }
})

test('BFCache configuration waits for validation and never delegates a refused check', async (t) => {
  const { promise, resolve } = Promise.withResolvers()
  const result = []
  const native = t.mock.method(BFCacheFailures.prototype, 'getArtifact', async () => result)
  const Gate = bfCacheConfig(() => promise).artifacts[0].gatherer
  const work = new Gate().getArtifact({})
  assert.equal(native.mock.callCount(), 0)
  resolve()
  assert.equal(await work, result)
  const Refused = bfCacheConfig(() => Promise.reject(new Error('navigation-identity-refused')))
    .artifacts[0].gatherer
  await assert.rejects(new Refused().getArtifact({}), /navigation-identity-refused/)
  assert.equal(native.mock.callCount(), 1)
})

test('BFCache configuration resolves against pinned defaults without changing inventory or metadata', async () => {
  const flags = {
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    disableFullPageScreenshot: true,
  }
  const base = (await initializeConfig('navigation', undefined, flags)).resolvedConfig
  const configured = (
    await initializeConfig(
      'navigation',
      bfCacheConfig(async () => {}),
      flags
    )
  ).resolvedConfig
  assert.deepEqual(configured.audits, base.audits)
  assert.deepEqual(configured.categories, base.categories)
  assert.deepEqual(configured.settings, base.settings)
  assert.deepEqual(
    configured.artifacts.map((a) => a.id),
    base.artifacts.map((a) => a.id)
  )
  const native = base.artifacts.at(-1),
    adapter = configured.artifacts.at(-1)
  assert.equal(adapter.id, 'BFCacheFailures')
  assert.ok(adapter.gatherer.instance instanceof BFCacheFailures)
  assert.deepEqual(adapter.dependencies, native.dependencies)
  assert.deepEqual(adapter.gatherer.instance.meta, native.gatherer.instance.meta)
})

test('document acceptance requires an attributable early or later refusal', () => {
  const code = 'measured-session-fence-missing'
  const probe = { path: '/api/auth/me', passed: true, status: 200 }
  const early = {
    id: 'members',
    valid: false,
    stage: 'page-identity',
    reason: code,
    navigationProof: [],
    probes: [probe],
  }
  for (const [change, expected] of [
    [{}, true],
    [{ stage: 'lighthouse', navigationProof: [{ passed: false, code }] }, true],
    [{ valid: true }, false],
    [{ id: 'login' }, false],
    [{ stage: 'control-split-document' }, false],
    [{ stage: 'control-retired-session' }, false],
    [{ reason: 'operation-refused' }, false],
    [{ navigationProof: undefined }, false],
    [{ stage: 'lighthouse', navigationProof: [] }, false],
    [{ navigationProof: [{ passed: false, code: 'operation-refused' }] }, false],
    [{ navigationProof: [{ passed: true, code }] }, false],
    [{ probes: undefined }, false],
    [{ probes: [{ ...probe, passed: false }] }, false],
    [{ probes: [{ ...probe, status: 401 }] }, false],
    [{ probes: [{ ...probe, path: '/api/console/access' }] }, false],
  ]) {
    assert.equal(documentRefusal({ ...early, ...change }, 'members', true, false), expected)
  }
  assert.equal(documentRefusal(early, 'login', true, false), false)
  assert.equal(documentRefusal(early, 'members', false, false), false)
  assert.equal(documentRefusal(early, 'members', true, true), false)
})
