import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allocateControlSocket } from './stand/control-socket.mjs'
import { LOCALE_CATALOGUES } from './lib/settings-files.mjs'
import { sourceSettings } from './stand/settings-policy.mjs'
import { projectChoices } from './stand/project.mjs'
import { runIdentity } from './lighthouse/identity.mjs'
import { run } from './stand/process.mjs'
import { collect, groupArguments } from './stand/test-inventory.mjs'

const worktree = process.cwd()
// The verifier inside each checkout validates against its own manifest protocol.
const { supervise } = await import(
  pathToFileURL(join(worktree, 'scripts/stand/supervisor.mjs')).href
)
const stands = join(worktree, '.amcore/stands')
await mkdir(stands, { recursive: true })
const id = 'browser-collection-' + randomUUID()
const directory = join(stands, id)
const token = randomUUID()

// Collect the base with its own lane admission rules as well as its own tests.
const basePlanner = await import(pathToFileURL(join(worktree, 'scripts/e2e-ci-plan.mjs')).href)
const legacy = typeof basePlanner.configuredLanes !== 'function'
if (legacy) {
  assert.equal(process.argv[3], '--pr-base', 'Only a PR base may use legacy browser collection')
  assert.equal(typeof basePlanner.selectedFiles, 'function', 'Unknown legacy browser planner')
  await run('git', ['diff', '--exit-code', 'HEAD', '--', 'packages/shared/src/config'], {
    cwd: worktree,
  })
}
const lanes = legacy
  ? [
      'configured-standard',
      ...(basePlanner.selectedFiles(worktree, 'disruptive').length
        ? ['configured-disruptive']
        : []),
      'configured-mocked',
    ]
  : basePlanner.configuredLanes(worktree)
const settings = await sourceSettings(worktree)
if (legacy) {
  assert.deepEqual(
    settings,
    {
      locales: { version: 1, enabled: LOCALE_CATALOGUES, default: 'en' },
      'admin-console': { version: 1, mode: 'path', alias: 'admin' },
      'product-admin': { version: 1, mode: 'path', alias: 'manage' },
    },
    'Unsupported product settings in legacy PR base'
  )
}
const choices = await projectChoices(worktree)
const inventories = {}
for (const lane of lanes) {
  await collectLane(lane)
}
await writeFile(
  process.argv[2],
  JSON.stringify({
    ...runIdentity(worktree),
    settings,
    lanes: inventories,
  }),
  { flag: 'wx' }
)

async function collectLane(lane) {
  await mkdir(directory, { recursive: true })
  const project = legacy
    ? lane === 'configured-mocked'
      ? 'mocked'
      : 'real-stack'
    : basePlanner.configuredProject(lane)
  try {
    const manifest = {
      id,
      worktree,
      snapshot: worktree,
      purpose: 'e2e',
      ...choices,
      settingsPolicy: 'preserve',
      lane: project,
      origins: {
        product:
          choices.topology === 'host' ? 'https://product.invalid:20000' : 'http://127.0.0.1:20000',
        ...(choices.consoleTopology === 'host' ? { console: 'https://ops.invalid:20000' } : {}),
        ...(choices.productAdminHost ? { staff: 'https://staff.invalid:20000' } : {}),
      },
      ports: { web: 20000 },
      relay: 'http://127.0.0.1:20001',
      controlSocket: await allocateControlSocket(),
      runToken: token,
    }
    const manifestPath = join(directory, 'manifest.json')
    await mkdir(join(directory, 'lease'))
    await writeFile(join(directory, 'lease/owner.json'), JSON.stringify({ token }))
    await writeFile(manifestPath, JSON.stringify(manifest))
    const close = await supervise(manifest, token)
    try {
      const options = {
        cwd: worktree,
        env: {
          ...process.env,
          CI: 'true',
          AMCORE_CONFIGURED_CASES: '1',
          AMCORE_STAND_MANIFEST: manifestPath,
          AMCORE_STAND_TOKEN: token,
        },
      }
      if (project !== 'real-stack') inventories[lane] = await collect(options, [], project)
      else {
        const group = lane.slice('configured-'.length)
        if (legacy) {
          const files = basePlanner.selectedFiles(worktree, group)
          const cases = await collect(options, [], project)
          assert.deepEqual(
            [...new Set(cases.map(({ file }) => file))].sort(),
            basePlanner.specFiles(worktree)
          )
          inventories[lane] = cases
            .filter(({ file }) => files.includes(file))
            .map(legacyRealStackCase)
          assert.ok(inventories[lane].length, 'Empty legacy browser group')
          return
        }
        await groupArguments(manifest, group, options)
        const inventory = JSON.parse(await readFile(join(directory, 'inventory.json'), 'utf8'))
        inventories[lane] = inventory.selected
      }
    } finally {
      await close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function legacyRealStackCase(item) {
  if (item.expectedStatus === 'passed') return item
  assert.equal(item.expectedStatus, 'skipped', 'Unexpected legacy browser case status')
  assert.equal(item.file, 'e2e/real-stack/admin-overview.spec.ts')
  assert.equal(item.skipReason, 'Requires owned fault/Grafana fixture')
  // The existing overview cases moved to the owned Console summary fixture.
  return { ...item, skipReason: 'requires:console-summary' }
}
