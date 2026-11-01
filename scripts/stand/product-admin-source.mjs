import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { productAdminEdgeFiles, renderProductAdminEdge } from '../lib/product-admin-edge.mjs'
import { prepareAppleOAuthFixture } from './apple-oauth-fixture.mjs'

export const productAdminProfiles = [
  'product-admin-three-host',
  'product-admin-console-path',
  'product-admin-closed-signup',
  'product-admin-oauth',
  'support-mail-path',
  'support-mail-host',
]

/** Copy-only topology rehearsal; never modifies the authoring checkout or runtime policy. */
export async function prepareProductAdminSource(m) {
  if (!m.productAdminHost && m.fixtureProfile !== 'product-admin-oauth-path') return
  const path = join(m.snapshot, 'packages/shared/src/config/product-admin.json')
  const config = JSON.parse(await readFile(path, 'utf8'))
  if (m.fixtureProfile === 'product-admin-oauth-path') {
    config.mode = 'path'
    await writeFile(path, JSON.stringify(config, null, 2) + '\n')
    productAdminEdgeFiles(m.snapshot, true)
    await prepareAppleOAuthFixture(m)
    return
  }
  if (productAdminProfiles.includes(m.fixtureProfile)) {
    config.mode = 'host'
    await writeFile(path, JSON.stringify(config, null, 2) + '\n')
  }
  if (config.mode !== 'host') throw new Error('Managed staff host requires host source placement')
  productAdminEdgeFiles(m.snapshot, true)
  let consoleBlock = ''
  if (m.consoleEnabled && m.consoleTopology === 'host') {
    const source = await readFile(join(m.snapshot, 'docker/caddy/Caddyfile.console-host'), 'utf8')
    const start = source.indexOf('# AMCORE_ADMIN_CONSOLE_PROXY_START')
    const end = source.indexOf('# AMCORE_ADMIN_CONSOLE_PROXY_END')
    if (start < 0 || end < start) throw new Error('Missing managed Console edge seam')
    consoleBlock = source.slice(start, end)
  }
  const content = `{
  local_certs
  auto_https disable_redirects
}
${renderProductAdminEdge(m.snapshot).caddy}
:443 {
  respond 404
}
{$CADDY_DOMAIN} {
  reverse_proxy api:5002 {
    header_up -X-Amcore-Web-Frontend
    header_up -X-Amcore-Web-Placement
    header_up -X-Amcore-Web-Context-Key
    header_up -X-AMCore-Client-Ip
  }
}
{$CADDY_WEB_DOMAIN} {
  import product_admin_site
}
{$PRODUCT_ADMIN_HOSTNAME} {
  import product_admin_staff
}
${consoleBlock}
`
  await writeFile(join(m.snapshot, 'docker/caddy/Caddyfile.product-admin-stand'), content)
  await prepareAppleOAuthFixture(m)
}
