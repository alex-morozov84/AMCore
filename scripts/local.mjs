import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { lease, load, root, stateRoot } from './stand/state.mjs'
import { children, run as runProcess, setJournal } from './stand/process.mjs'
import { docker } from './stand/docker.mjs'
import { labels } from './stand/config.mjs'
import { isProductStandId, localDispatchId, recoverLocalDispatch } from './stand/local-dispatch.mjs'
import { localSummary } from './stand/local-summary.mjs'
import { sourceSettings } from './stand/settings-policy.mjs'
import { canonicalStringify } from './lib/path-algebra-canonical.mjs'
import { consoleEdgeFiles } from './lib/console-edge.mjs'
import { productAdminEdgeFiles } from './lib/product-admin-edge.mjs'

function run(action, id, token, options = []) {
  return runProcess(
    process.execPath,
    [
      join(root, 'scripts/stand.mjs'),
      action,
      '--id',
      id,
      '--local-dispatch-token',
      token,
      ...options,
    ],
    { cwd: root, env: process.env }
  )
}

async function reportStatus(stands, selected) {
  console.log(`Selected configuration: ${selected ?? 'unavailable'}`)
  for (const stand of stands) {
    if (stand.state === 'purged') continue
    if (stand.state === 'unallocated') {
      console.log(`${stand.id}: no stand manifest; inspect interruption with pnpm local recover`)
      continue
    }
    const filters = Object.entries(labels(stand)).flatMap(([key, value]) => [
      '--filter',
      `label=${key}=${value}`,
    ])
    try {
      const running = (
        await docker(stand, ['ps', ...filters, '--format', '{{.Names}}'], { capture: true })
      ).trim()
      console.log(
        `${stand.id}: ${running ? `running containers · ${stand.origins.product}` : 'no running containers'}`
      )
    } catch (error) {
      console.log(`${stand.id}: actual state unknown (${error.message})`)
    }
  }
  if (!stands.some((stand) => stand.id === selected))
    console.log('No dataset for the selected configuration.')
}

async function productStands() {
  const entries = await readdir(stateRoot).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const manifests = await Promise.all(
    entries.filter(isProductStandId).map((id) =>
      load(id).catch((error) => {
        if (error.code !== 'ENOENT') throw error
        return { id, state: 'unallocated' }
      })
    )
  )
  return manifests
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
  if (extra.length || !['up', 'down', 'status', 'recover'].includes(action))
    throw new Error('Usage: pnpm local [up|down|status|recover]')
  if (action === 'recover') return recoverLocalDispatch()
  if (action === 'status') {
    const stands = await productStands()
    return reportStatus(stands, await configuredId(stands).catch(() => undefined))
  }
  const { release, token } = await lease(localDispatchId, action).catch((error) => {
    throw new Error(`${error.message}. If interrupted, use pnpm local recover.`, { cause: error })
  })
  setJournal(join(stateRoot, localDispatchId, 'lease', 'children.json'))
  let id
  try {
    const stands = await productStands()
    if (action === 'up') {
      consoleEdgeFiles(root)
      productAdminEdgeFiles(root)
    }
    id = action === 'up' ? await configuredId(stands) : undefined
    if (
      id &&
      stands.some((stand) => stand.id !== id && stand.state !== 'purged') &&
      !stands.some((stand) => stand.id === id && stand.state === 'app-ready')
    )
      console.log(
        'Using the dataset for the current product settings. Other local datasets are retained.'
      )
    for (const stand of stands) {
      if (['stopped', 'purged', 'unallocated'].includes(stand.state) || stand.id === id) continue
      await run('down', stand.id, token)
    }
    if (id) {
      await run('up', id, token, ['--settings-policy', 'preserve'])
      console.log(localSummary(await load(id)))
    }
  } catch (error) {
    await productStands()
      .then((stands) => reportStatus(stands, id))
      .catch(() => console.log('Actual stand state unavailable. Run pnpm local status.'))
    throw error
  } finally {
    setJournal(undefined)
    if (children.size === 0) await release()
    else console.error('Process ownership is still active. Use pnpm local recover after it exits.')
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
