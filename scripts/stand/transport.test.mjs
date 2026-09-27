import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { relay } from './relay.mjs'

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const { chromium, request } = require('@playwright/test')
const listen = (server, port = 0) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections()
    server.close(resolve)
  })

test('real Chromium and APIRequest route loopback through relay, deny foreign sentinel and direct fallback', async () => {
  let sentinelRequests = 0
  const sentinel = createServer((_req, res) => {
    sentinelRequests++
    res.end('foreign')
  })
  await listen(sentinel)
  const foreign = `http://127.0.0.1:${sentinel.address().port}`
  const owned = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: foreign }).end()
      return
    }
    res.end('owned')
  })
  await listen(owned)
  const origin = `http://app-transport.localhost:${owned.address().port}`
  const proxy = await relay([origin])
  const browser = await chromium.launch({
    proxy: { server: proxy.url },
    args: ['--proxy-bypass-list=<-loopback>'],
  })
  const api = await request.newContext({ proxy: { server: proxy.url } })
  try {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      assert.equal((await page.goto(origin)).status(), 200)
      assert.equal(await page.textContent('body'), 'owned')
      assert.equal((await page.goto(foreign)).status(), 403)
      assert.equal((await page.goto(origin + '/redirect')).status(), 403)
      assert.equal((await context.request.get(origin)).status(), 200)
      assert.equal((await api.get(origin)).status(), 200)
      assert.equal((await api.get(foreign)).status(), 403)
      assert.equal(sentinelRequests, 0)
      await proxy.close()
      await assert.rejects(() => page.goto(origin, { timeout: 5000 }))
      assert.equal(sentinelRequests, 0)
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
    await api.dispose()
    await proxy.close()
    await close(owned)
    await close(sentinel)
  }
})
