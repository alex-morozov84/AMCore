import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { relay } from './relay.mjs'

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
test('browser socket resets do not crash the managed relay or turn into successful responses', async () => {
  const source = createServer((req, res) =>
    req.url === '/reset' ? req.socket.resetAndDestroy() : res.end('ready')
  )
  source.on('clientError', (_, socket) => socket.destroy())
  await listen(source)
  const origin = `http://owned.localhost:${source.address().port}`
  const proxy = await relay([origin])
  try {
    const status = await new Promise((resolve) => {
      const req = request(
        `${proxy.url}`,
        { path: `${origin}/reset`, headers: { host: new URL(origin).host } },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        }
      )
      req.on('error', () => resolve(0))
      req.end()
    })
    assert.ok(status === 0 || status >= 500)
    const socket = connect(Number(new URL(proxy.url).port), '127.0.0.1')
    socket.on('error', () => {})
    await new Promise((resolve) => socket.once('connect', resolve))
    socket.write(`CONNECT foreign.invalid:443 HTTP/1.1\r\nHost: foreign.invalid:443\r\n\r\n`)
    socket.resetAndDestroy()
    const response = await fetch(proxy.url, { headers: { host: new URL(origin).host } })
    assert.equal(response.status, 403)
  } finally {
    await proxy.close()
    await new Promise((resolve) => source.close(resolve))
  }
})
