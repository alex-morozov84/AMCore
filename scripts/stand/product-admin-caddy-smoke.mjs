import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

import { checkProductAdminWire } from './product-admin-wire-checks.mjs'

/**
 * The stand's own Caddy already carries the generated product-administration mapping, so this
 * only asks it the same questions the nginx smoke asks nginx. It needs no overlay and no extra
 * container, which keeps the stand's cleanup evidence unchanged.
 */
export async function productAdminCaddySmoke(m) {
  assert.equal(m.purpose, 'e2e')
  assert.equal(m.productAdminHost, true)
  const directory = `${m.snapshot}/docker/caddy/product-admin-smoke`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await checkProductAdminWire(m, { edge: 'caddy', port: m.ports.tls, directory })
  console.log('Product admin Caddy TLS wire smoke: passed')
}
