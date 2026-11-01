import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  consoleEdgeFiles,
  renderConsoleCaddy,
  renderConsoleNginxLocations,
} from './console-edge.mjs'

const root = join(import.meta.dirname, '../..')

function copy(t) {
  const dir = mkdtempSync(join(tmpdir(), 'amcore-console-edge-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const file of [
    'docker/caddy/Caddyfile.console-host',
    'docker/nginx/operations-console.conf',
    'packages/shared/src/config/locales.json',
    'packages/shared/src/config/admin-console.json',
  ])
    cpSync(join(root, file), join(dir, file), { recursive: true })
  return dir
}

test('the committed Console edge files match the settings files', () => {
  assert.doesNotThrow(() => consoleEdgeFiles(root, false))
})

test('several locales: pages keep the locale prefix and map onto the alias folder', () => {
  const settings = { alias: 'admin', locales: ['en', 'ru'] }
  assert.match(renderConsoleCaddy(settings), /\^\/\(en\|ru\)\(\/\.\*\)\?\$/)
  assert.match(
    renderConsoleCaddy(settings),
    /rewrite \* \/\{re\.consolePage\.1\}\/admin\{re\.consolePage\.2\}/
  )
  assert.match(
    renderConsoleNginxLocations(settings),
    /rewrite \^\/\(en\|ru\)\(\/\.\*\)\?\$ \/\$1\/admin\$2 break;/
  )
})

test('one locale: public pages carry no prefix and still map onto the alias folder', () => {
  const settings = { alias: 'ops', locales: ['ru'] }
  const caddy = renderConsoleCaddy(settings)
  assert.match(caddy, /path \/ops \/ops\/\*/)
  assert.match(caddy, /rewrite \* \/ops\{re\.consolePage\.1\}/)
  assert.match(caddy, /@consoleNextAssets path \/_next\/\*/)
  assert.doesNotMatch(caddy, /\(en\|ru\)|\(ru\)/)
  const nginx = renderConsoleNginxLocations(settings)
  assert.match(nginx, /location = \/ops \{\s+return 404;/)
  assert.match(nginx, /rewrite \^\(\.\*\)\$ \/ops\$1 break;/)
  assert.match(nginx, /location \^~ \/_next\//)
  assert.doesNotMatch(nginx, /\(en\|ru\)|\(ru\)/)
})

test('a changed alias or locale list makes --check fail until regenerated', (t) => {
  const dir = copy(t)
  writeFileSync(
    join(dir, 'packages/shared/src/config/locales.json'),
    '{"version":1,"enabled":["en"],"default":"en"}\n'
  )
  assert.throws(() => consoleEdgeFiles(dir, false), /stale/)
  consoleEdgeFiles(dir, true)
  assert.doesNotThrow(() => consoleEdgeFiles(dir, false))
  assert.doesNotMatch(
    readFileSync(join(dir, 'docker/caddy/Caddyfile.console-host'), 'utf8'),
    /\(en\|ru\)/
  )
})

test('missing markers are an error, not a silent no-op', (t) => {
  const dir = copy(t)
  const file = join(dir, 'docker/nginx/operations-console.conf')
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('AMCORE_ADMIN_CONSOLE_LOCATIONS_START', 'x')
  )
  assert.throws(() => consoleEdgeFiles(dir, false), /markers/)
})
