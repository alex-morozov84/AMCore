import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export async function sourceSettings(root) {
  return Object.fromEntries(
    await Promise.all(
      ['locales', 'admin-console', 'product-admin'].map(async (name) => [
        name,
        JSON.parse(await readFile(join(root, `packages/shared/src/config/${name}.json`), 'utf8')),
      ])
    )
  )
}

/** Retain source and exercised choices in the existing stand manifest. */
export async function recordSettings(m) {
  m.exercisedSettings = await sourceSettings(m.snapshot)
  await assertSettings(m)
}

export async function assertSettings(m) {
  if (!m.settingsPolicy) return // Existing retained stands predate this manifest field.
  if (!['preserve', 'variant'].includes(m.settingsPolicy))
    throw new Error('Invalid settings policy')
  const exercised = await sourceSettings(m.snapshot)
  if (!isDeepStrictEqual(exercised, m.exercisedSettings))
    throw new Error('Stand settings changed after preparation')
  if (m.settingsPolicy === 'preserve' && !isDeepStrictEqual(m.sourceSettings, exercised))
    throw new Error('Product execution must preserve source settings')
}

export async function assertCompiledSettings(m, configured = false, fixture) {
  await assertSettings(m)
  const settings = m.exercisedSettings
  const source = await sourceSettings(m.worktree)
  assert.deepEqual(m.sourceSettings, source, 'Source settings changed')
  if (fixture === 'console-summary') {
    source['admin-console'].mode = 'path'
    source['product-admin'].mode = 'path'
  }
  assert.deepEqual(settings, source, 'Exercised settings differ from the browser plan')
  const shared = await import(pathToFileURL(join(m.snapshot, 'packages/shared/dist/index.js')).href)
  assert.deepEqual(shared.SERVED_LOCALES, settings.locales.enabled)
  assert.equal(shared.DEFAULT_LOCALE, settings.locales.default)
  assert.deepEqual(shared.ADMIN_CONSOLE_SETTINGS, settings['admin-console'])
  assert.deepEqual(shared.PRODUCT_ADMIN_CONFIG, settings['product-admin'])
  if (configured) assertConfiguredTransport(m, settings)
}

function assertConfiguredTransport(m, settings) {
  const staffHost = settings['product-admin'].mode === 'host'
  const consoleMode = settings['admin-console'].mode
  const consoleHost = consoleMode === 'host'
  assert.equal(m.productAdminHost, staffHost)
  assert.equal(m.consoleTopology, consoleHost ? 'host' : 'path')
  assert.equal(m.consoleEnabled, consoleMode !== 'disabled')
  assert.equal(m.topology, staffHost || consoleHost ? 'host' : 'path')
  const { product, staff, console } = m.origins
  const productProtocol = staffHost || consoleHost ? 'https:' : 'http:'
  assert.equal(new URL(product).protocol, productProtocol)
  const isolated = [product, ...(staffHost ? [staff] : []), ...(consoleHost ? [console] : [])]
  const origins = isolated.map((address) => new URL(address).origin)
  assert.equal(new Set(origins).size, origins.length, 'Configured audiences need distinct origins')
  for (const origin of origins.slice(1)) assert.equal(new URL(origin).protocol, 'https:')
}

export function assertPreserveRequest(policy, fixture, topology, choices) {
  if (!['preserve', 'variant'].includes(policy)) throw new Error('Invalid settings policy')
  if (policy === 'preserve' && (fixture || (topology && topology !== choices.topology)))
    throw new Error('Preserved settings cannot use a topology variant or fixture')
}

/** Admit native transport before allocating a stand or contacting its engine. */
export function preservedTopology(lane, choices) {
  if (
    lane === 'console-real-stack' &&
    (!choices.consoleEnabled || choices.consoleTopology !== 'host')
  )
    throw new Error('Native Console lane requires enabled host source settings')
  if (lane === 'product-admin-real-stack')
    throw new Error('Native product checks use real-stack, not starter staff fixtures')
  if (lane === 'mocked' && choices.topology === 'host' && !process.env.AMCORE_MOCK_TLS_DIR)
    throw new Error('Native mocked host transport is not prepared')
  return choices.topology
}
