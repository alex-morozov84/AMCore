import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rawOwnedRequest } from '../../apps/web/e2e/support/raw-target.mjs'
import { run } from './process.mjs'

test('raw Node transport preserves path/Host/SNI, trusts only its fixture CA and has no redirect/DNS fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-raw-tls-'))
  const caFile = join(dir, 'root.crt')
  const key = join(dir, 'root.key')
  const host = 'console-raw-proof.localhost'
  let server,
    received = []
  try {
    await run(
      'openssl',
      [
        'req',
        '-x509',
        '-nodes',
        '-newkey',
        'rsa:2048',
        '-days',
        '1',
        '-keyout',
        key,
        '-out',
        caFile,
        '-subj',
        `/CN=${host}`,
        '-addext',
        `subjectAltName=DNS:${host}`,
      ],
      { capture: true }
    )
    server = createServer(
      { key: await readFile(key), cert: await readFile(caFile) },
      (req, res) => {
        received.push({
          host: req.headers.host,
          sni: req.socket.servername,
          path: req.url,
          origin: req.headers.origin,
        })
        if (req.url === '/redirect')
          res.writeHead(302, { location: 'https://foreign.invalid/' }).end()
        else res.end('owned')
      }
    )
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const origin = `https://${host}:${server.address().port}`
    const target = { origins: { console: origin }, caFile }
    assert.equal((await rawOwnedRequest(target, origin, '/api/x/../Auth/Login')).body, 'owned')
    assert.deepEqual(received[0], {
      host: new URL(origin).host,
      sni: host,
      path: '/api/x/../Auth/Login',
      origin,
    })
    assert.equal((await rawOwnedRequest(target, origin, '/redirect')).status, 302)
    await assert.rejects(() => rawOwnedRequest(target, 'https://foreign.invalid/', '/'), /Foreign/)
    await assert.rejects(
      () => rawOwnedRequest({ origins: target.origins }, origin, '/'),
      /dispatch failed/
    )
    assert.equal(received.length, 2)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await assert.rejects(() => rawOwnedRequest(target, origin, '/'), /dispatch failed/)
    assert.equal(received.length, 2)
  } finally {
    if (server?.listening) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
    await rm(dir, { recursive: true, force: true })
  }
})
