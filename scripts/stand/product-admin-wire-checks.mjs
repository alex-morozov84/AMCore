import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { inspectProductAdminPlacement } from '../lib/product-admin-placement.mjs'

import { run } from './process.mjs'

/**
 * The same public-wire expectations for either edge. The transport stays on loopback while the
 * request carries the exact public Host, so the generated mapping, not DNS, decides the answer.
 * With one served locale `m.localePrefix` is empty and the pages carry no prefix.
 */
export async function checkProductAdminWire(m, { edge, port, directory }) {
  const { alias } = inspectProductAdminPlacement(m.snapshot)
  const prefix = m.localePrefix
  for (const [host, path, expected] of [
    [m.hostnames.staff, `${prefix}/login`, 200],
    [m.hostnames.staff, `${prefix}/${alias}/organizations`, 404],
    [m.hostnames.product, `${prefix}/${alias}/organizations`, 404],
    [m.hostnames.staff, `${prefix}/unknown-staff-page`, 404],
    [m.hostnames.staff, '/api/auth/login', 404],
    [m.hostnames.product, '/api/product-admin/auth/login', 404],
    [m.hostnames.staff, '/api/auth/me', 401],
    [m.hostnames.staff, '/favicon.ico', 200],
  ]) {
    const body = `${directory}/response-${edge}.html`
    const status = await run(
      'curl',
      [
        '--silent',
        '--show-error',
        '--insecure',
        '--noproxy',
        '*',
        '--resolve',
        `${host}:${port}:127.0.0.1`,
        '--header',
        `Host: ${host}:${m.ports.tls}`,
        '--output',
        body,
        '--write-out',
        '%{http_code}',
        `https://${host}:${port}${path}`,
      ],
      { capture: true }
    )
    assert.equal(Number(status), expected, `${edge} ${path}`)
    if (path === `${prefix}/login`) assert.match(await readFile(body, 'utf8'), /Sign in|Вход/)
  }
}
