import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const compose = (path) => parse(read(path))

// Every shipped Caddy source that can front apps/api. The stand source builds its
// Caddyfile in JavaScript; its API site is checked as text the same way. The
// Console host-mode file exists only in projects that keep that topology.
const REQUIRED_CADDY_SOURCES = [
  'docker/caddy/Caddyfile',
  'docker/caddy/Caddyfile.web',
  'docker/caddy/product-admin.generated.caddy',
  'scripts/stand/product-admin-source.mjs',
]
const CADDY_SOURCES = [...REQUIRED_CADDY_SOURCES, 'docker/caddy/Caddyfile.console-host'].filter(
  (path) => REQUIRED_CADDY_SOURCES.includes(path) || existsSync(join(root, path))
)

/** Returns each `reverse_proxy api:5002` with its block body ('' for a one-line form). */
function apiProxies(text) {
  const found = []
  const pattern = /reverse_proxy\s+api:5002\s*(\{)?/g
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (!match[1]) {
      found.push('')
      continue
    }
    const start = pattern.lastIndex
    let depth = 1
    let end = start
    while (depth > 0 && end < text.length) {
      if (text[end] === '{') depth += 1
      if (text[end] === '}') depth -= 1
      end += 1
    }
    found.push(text.slice(start, end - 1))
  }
  return found
}

test('every Caddy upstream to the API strips the BFF relay claim', () => {
  for (const path of CADDY_SOURCES) {
    for (const body of apiProxies(read(path))) {
      assert.match(body, /header_up\s+-X-AMCore-Client-Ip\b/i, `${path}: missing strip`)
    }
  }
  assert.ok(apiProxies(read('docker/caddy/Caddyfile')).length > 0, 'parser found no API site')
})

test('shipped Caddy sources never trust forwarded client addresses', () => {
  // Caddy replaces X-Forwarded-For from an untrusted client; trusted_proxies would let a
  // client choose the address the web BFF relays (docker/compose/bff-relay.yml).
  for (const path of CADDY_SOURCES) assert.doesNotMatch(read(path), /trusted_proxies/, path)
})

test('reference nginx API locations strip the BFF relay claim', () => {
  const doc = read('docs/operations/deployment.md')
  const locations = doc.match(/location [^{]+\{[^}]*proxy_pass http:\/\/api:5002;[^}]*\}/g)
  assert.ok(locations?.length, 'no reference nginx API location found')
  for (const block of locations) assert.match(block, /proxy_set_header X-AMCore-Client-Ip "";/)
})

test('the relay overlay trusts exactly the fixed web address', () => {
  const relay = compose('docker/compose/bff-relay.yml')
  const address = '${COMPOSE_WEB_IPV4:?Set COMPOSE_WEB_IPV4}'
  assert.equal(relay.services.api.environment.TRUSTED_WEB_PEERS, address)
  assert.equal(relay.services.worker.environment.TRUSTED_WEB_PEERS, address)
  assert.match(relay.services.web.networks.default.ipv4_address, /^\$\{COMPOSE_WEB_IPV4:\?/)
  assert.equal(relay.services.web.environment.WEB_TRUSTED_CLIENT_IP_HEADER, 'x-forwarded-for')
  const base = compose('docker-compose.yml')
  assert.equal(base['x-app-env'].TRUSTED_WEB_PEERS, '${TRUSTED_WEB_PEERS:-}')
  const overlays = ['docker/compose/web.yml', 'docker/compose/console-host.yml']
  for (const path of overlays.filter((file) => existsSync(join(root, file)))) {
    assert.doesNotMatch(read(path), /TRUSTED_WEB_PEERS|ipv4_address|ipam/, path)
  }
})

test('the Postgres TLS overlay keeps every base server option', () => {
  const base = compose('docker-compose.yml').services.postgres.command.split(/\s+/)
  const tls = compose('docker/compose/postgres-tls.yml').services.postgres.command.split(/\s+/)
  assert.deepEqual(tls.slice(0, base.length), base)
  for (const option of ['ssl=on', 'hba_file=/etc/postgresql/pg_hba.tls.conf'])
    assert.ok(tls.includes(option), option)
  const hba = read('docker/postgres/pg_hba.tls.conf')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
  assert.deepEqual(
    hba.map((line) => line.split(/\s+/)[0]),
    ['local', 'hostssl', 'host'],
    'TLS rule must precede the final network reject'
  )
  assert.match(hba.at(-1), /^host\s+all\s+all\s+all\s+reject$/)
})

test('only one-shot services receive the migration (owner) URL', () => {
  const base = compose('docker-compose.yml').services
  const oneShot = new Set(['migrate', 'seed', 'restore'])
  for (const [name, service] of Object.entries(base)) {
    const env = JSON.stringify(service.environment ?? {})
    if (env.includes('MIGRATION_DATABASE_URL')) assert.ok(oneShot.has(name), name)
  }
  assert.equal(base.seed.restart, 'no')
  assert.equal(base.seed.environment.MIGRATION_DATABASE_URL, '${MIGRATION_DATABASE_URL:-}')
})

test('the local-build supervision overlay matches the registry overlay', () => {
  const prod = compose('docker/compose/prod.yml')
  const supervise = compose('docker/compose/supervise.yml')
  assert.deepEqual(supervise['x-logging'], prod['x-logging'])
  for (const [name, service] of Object.entries(prod.services)) {
    assert.ok(supervise.services[name], `supervise.yml lacks ${name}`)
    assert.equal(supervise.services[name].restart, service.restart, name)
  }
})
