/* global navigator, window, document, Event, caches */
import assert from 'node:assert/strict'

const route = '/en/deployment-probe'
const count = (state, method, path) =>
  state.records.filter((r) => r.method === method && r.path === path).length

async function open(browser, state, port, worker, poll = true) {
  state.target = port + 1
  state.mode = 'normal'
  const context = await browser.newContext({ serviceWorkers: worker })
  const page = await context.newPage()
  const errors = []
  const violations = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.exposeFunction('reportDeploymentCsp', (value) => violations.push(value))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      window.reportDeploymentCsp(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })
  await page.goto(`http://127.0.0.1:${port}${route}?poll=${Number(poll)}`)
  if (worker === 'allow') {
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.reload()
  }
  await page.waitForTimeout(500)
  return { context, page, errors, violations }
}

async function transition(tab, state, port, target, observe = 60_000) {
  state.records = []
  state.target = port + (target === 'A' ? 1 : 2)
  const started = Date.now()
  await tab.page.getByRole('heading', { name: `Build ${target}` }).waitFor({ timeout: 35_000 })
  const elapsed = Date.now() - started
  const old = `version-test-${target === 'A' ? 'B' : 'A'}`
  const stale = state.records.filter((r) => r.method === 'POST' && r.id === old)
  assert.ok(stale.length <= 100)
  assert.ok(stale.every((r) => r.status === 404))
  assert.equal(count(state, 'GET', route), 1)
  state.records = []
  await tab.page.waitForTimeout(observe)
  assert.equal(state.records.filter((r) => r.method === 'POST' && r.id === old).length, 0)
  assert.equal(count(state, 'GET', route), 0)
  assert.deepEqual(tab.errors, [])
  assert.deepEqual(tab.violations, [])
  console.log(
    JSON.stringify({
      target,
      elapsed,
      stale: stale.length,
      observe,
      versionGET: count(state, 'GET', '/api/deployment-version'),
    })
  )
}

async function faults(browser, state, port) {
  for (const mode of ['fail', 'invalid', 'hang', 'stale']) {
    const tab = await open(browser, state, port, 'block', false)
    state.target = port + 2
    state.mode = mode
    state.records = []
    await tab.page.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await tab.page.waitForTimeout(7000)
    assert.equal(await tab.page.locator('h1').textContent(), 'Build A')
    assert.ok(count(state, 'GET', '/api/deployment-version') <= 1)
    assert.equal(count(state, 'GET', route), 0)
    state.mode = 'normal'
    await tab.page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await tab.page.getByRole('heading', { name: 'Build B' }).waitFor({ timeout: 5000 })
    assert.deepEqual(tab.errors, [])
    await tab.context.close()
    console.log(`Signal ${mode}: bounded failure and restored recovery passed`)
  }
}

async function guards(browser, state, port) {
  const tab = await open(browser, state, port, 'block', false)
  state.target = port + 2
  state.mode = 'old-html'
  state.records = []
  await tab.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await tab.page.waitForTimeout(35_000)
  assert.equal(count(state, 'GET', route), 1)
  state.mode = 'normal'
  await tab.page.reload()
  await tab.page.getByRole('heading', { name: 'Build B' }).waitFor()
  await tab.context.close()
  console.log('Stale HTML: no replacement loop; manual recovery passed')
}

export async function verifyRecovery(browser, state, port) {
  const plain = await open(browser, state, port, 'block')
  await transition(plain, state, port, 'B')
  await plain.context.close()
  const worker = await open(browser, state, port, 'allow')
  await transition(worker, state, port, 'B')
  await transition(worker, state, port, 'A')
  await transition(worker, state, port, 'B', 1000)
  state.mode = 'alternate'
  state.records = []
  await worker.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await worker.page.waitForTimeout(1000)
  assert.equal(count(state, 'GET', route), 0)
  const cached = await worker.page.evaluate(async () => {
    const keys = await caches.keys()
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname)
        )
      )
    ).flat()
  })
  assert.ok(
    cached.every((path) => ['/icons/icon-192x192.png', '/icons/icon-512x512.png'].includes(path))
  )
  await worker.context.close()
  const idle = await open(browser, state, port, 'block', false)
  state.records = []
  await idle.page.waitForTimeout(120_000)
  assert.ok(count(state, 'GET', '/api/deployment-version') <= 4)
  await idle.context.close()
  await faults(browser, state, port)
  await guards(browser, state, port)
}
