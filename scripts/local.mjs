import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { lease, load, root, stateRoot } from './stand/state.mjs'
import { localSummary } from './stand/local-summary.mjs'
import { sourceSettings } from './stand/settings-policy.mjs'
import { canonicalStringify } from './lib/path-algebra-canonical.mjs'
import { consoleEdgeFiles } from './lib/console-edge.mjs'
import { productAdminEdgeFiles } from './lib/product-admin-edge.mjs'

function run(action, id, options = []) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/stand.mjs'), action, '--id', id, ...options],
    { cwd: root, stdio: 'inherit' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Local stand ${action} failed for ${id}`)
}

async function productStands() {
  const entries = await readdir(stateRoot).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const ids = entries.filter((id) => /^local-[a-f0-9]{24}(?:-[1-9][0-9]*)?$/.test(id))
  return Promise.all(ids.map((id) => load(id)))
}

async function configuredId(stands) {
  const settings = await sourceSettings(root)
  const hash = createHash('sha256').update(canonicalStringify(settings)).digest('hex')
  const base = `local-${hash.slice(0, 24)}`
  const retired = new Set(stands.filter(({ state }) => state === 'purged').map(({ id }) => id))
  let id = base
  for (let index = 1; retired.has(id); index++) id = `${base}-${index}`
  return id
}

async function main() {
  const [action = 'up', ...extra] = process.argv.slice(2)
  if (extra.length || !['up', 'down', 'status'].includes(action))
    throw new Error('Usage: pnpm local [up|down|status]')
  if (action === 'status') {
    const stands = await productStands()
    const id = await configuredId(stands)
    if (stands.some((stand) => stand.id === id)) run('status', id)
    else console.log('No local stand for the current product settings. Run pnpm local.')
    return
  }
  const { release } = await lease('local-dispatch', action)
  try {
    const stands = await productStands()
    if (action === 'up') {
      consoleEdgeFiles(root)
      productAdminEdgeFiles(root)
    }
    const id = action === 'up' ? await configuredId(stands) : undefined
    if (
      id &&
      stands.some((stand) => stand.id !== id && stand.state !== 'purged') &&
      !stands.some((stand) => stand.id === id && stand.state === 'app-ready')
    )
      console.log(
        'Using the dataset for the current product settings. Other local datasets are retained.'
      )
    for (const stand of stands) {
      if (['stopped', 'purged'].includes(stand.state) || stand.id === id) continue
      run('down', stand.id)
    }
    if (id) {
      run('up', id, ['--settings-policy', 'preserve'])
      console.log(localSummary(await load(id)))
    }
  } finally {
    await release()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
