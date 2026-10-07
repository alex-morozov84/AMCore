import { snapshot } from './stand/snapshot.mjs'
import { refresh } from './stand/refresh.mjs'
import { randomUUID } from 'node:crypto'
import { create } from './stand/create.mjs'
import { root, load, lease } from './stand/state.mjs'
import { boot } from './stand/boot.mjs'
import { cleanup, dataAdmission } from './stand/ownership.mjs'
import { test } from './stand/playwright.mjs'
import { stopChildren, setJournal, requestCancellation, allowCleanup } from './stand/process.mjs'

const [action = 'help', ...args] = process.argv.slice(2)
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
const lane = value('--lane', 'real-stack')
const group = value('--ci-group')
if (group && (lane !== 'real-stack' || !['standard', 'disruptive'].includes(group)))
  throw new Error('Invalid E2E CI group')
const lanes = ['mocked', 'real-stack']
let topology
// AMCORE_CONSOLE_LANES_START
lanes.push('console-real-stack')
if (lane === 'console-real-stack') topology = 'host'
// AMCORE_CONSOLE_LANES_END
const id = value('--id', action === 'e2e' ? `e2e-${randomUUID()}` : 'preview')
// Explicit risk acceptance for a build whose Docker export is not proved finished;
// recorded in the manifest as acceptance, never as proof (see local-stands guide).
const cleanupOptions = { acceptReason: value('--accept-unresolved-build') }
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    interrupted = true
    requestCancellation()
    process.exitCode = signal === 'SIGINT' ? 130 : 143
    try {
      await stopChildren()
    } catch (error) {
      console.error(`Cancellation incomplete; retain lease/recovery: ${error.message}`)
    }
  })
async function execute() {
  if (action === 'help') {
    console.log(
      `pnpm stand up|preview|e2e|status|list|down|recover|closeout [--id ID] [--purge] [--accept-unresolved-build "<reason>"]\ne2e --lane ${lanes.join('|')}\nManaged local stands; never owner .env. Native pnpm dev is outside these guards.`
    )
    return
  }
  if (action === 'list') {
    const { list } = await import('./stand/list.mjs')
    await list()
    return
  }
  if (action === 'status') {
    const m = await load(id)
    console.log(
      JSON.stringify(
        {
          id,
          state: m.state,
          origins: m.origins,
          sourceHash: m.sourceHash,
          stale: (await snapshot(m.worktree)) !== m.sourceHash,
        },
        null,
        2
      )
    )
    return
  }
  if (action === 'closeout') {
    const { closeout } = await import('./stand/closeout.mjs')
    await closeout()
    return
  }
  if (action === 'recover') {
    const { recover } = await import('./stand/recovery.mjs')
    await recover(id, args.includes('--purge'), cleanupOptions)
    return
  }
  if (!['up', 'preview', 'e2e', 'down'].includes(action)) throw new Error('Unknown stand action')
  if (!lanes.includes(lane)) throw new Error('Unknown lane')
  if (action !== 'e2e' && lane === 'mocked') throw new Error('Mocked lane is e2e-only')
  if (args.includes('--proxy-smoke') && topology !== 'host')
    throw new Error('Proxy smoke unavailable in this fork')
  const held = await lease(id, action)
  setJournal(`${root}/.amcore/stands/${id}/lease/children.json`)
  let m
  try {
    if (action === 'down') {
      m = await load(id, args.includes('--orphan'))
      await cleanup(m, args.includes('--purge'), cleanupOptions)
      return
    }
    const existing = await load(id).catch((e) => {
      if (e.code !== 'ENOENT') throw e
    })
    if (existing) {
      if (Boolean(existing.mocked) !== (lane === 'mocked'))
        throw new Error('Cannot switch a recorded stand between mocked and Docker lanes')
      if (action === 'e2e' && existing.purpose !== 'e2e')
        throw new Error('E2E cannot mutate a preview stand')
      if (action !== 'e2e' && existing.purpose !== 'preview')
        throw new Error('Preview requires a preview-purpose stand')
      if (action === 'e2e' && (existing.topology === 'host') !== (topology === 'host'))
        throw new Error('E2E topology does not match selected lane')
      if (existing.state === 'purged') throw new Error('Purged ID; select a fresh stand ID')
      m = existing
      if (lane !== 'mocked' && !['stopped', 'allocated', 'configured'].includes(m.state))
        await dataAdmission(m)
      await refresh(m)
    } else
      m = await create(
        id,
        action === 'e2e' ? 'e2e' : 'preview',
        topology,
        action === 'e2e' && lane === 'mocked'
      )
    if (lane !== 'mocked') await boot(m, !existing)
    if (interrupted) throw new Error('Interrupted startup')
    if (action === 'e2e') {
      const extra = args.includes('--') ? args.slice(args.indexOf('--') + 1) : []
      if (extra.some((arg) => /^(--config|--output|--global)/.test(arg)))
        throw new Error('Managed configuration cannot be overridden')
      let handled = false
      // AMCORE_CONSOLE_PROXY_SMOKE_START
      if (args.includes('--proxy-smoke')) {
        if (lane !== 'console-real-stack') throw new Error('Proxy smoke requires host lane')
        const { proxySmoke } = await import('./stand/proxy-smoke.mjs')
        await proxySmoke(m)
        handled = true
      }
      // AMCORE_CONSOLE_PROXY_SMOKE_END
      if (!handled) await test(m, lane, held.token, extra, group)
    } else if (action === 'preview') {
      const { preview } = await import('./stand/preview.mjs')
      await preview(m, value('--profile', 'default'))
    } else console.log(`Stand ${id}: ${m.origins.product}`)
  } finally {
    await stopChildren()
    allowCleanup()
    let cleanupError
    if (m && action === 'e2e' && lane !== 'mocked') {
      try {
        await cleanup(m, true) // records its own failure/incomplete state
      } catch (e) {
        cleanupError = e
      }
    }
    setJournal(undefined)
    await held.release()
    if (cleanupError) {
      console.error(`Cleanup failed: ${cleanupError.message}`)
      if (!interrupted) process.exitCode = 1
    }
  }
}
execute().catch((e) => {
  console.error(e.message)
  if (!interrupted) process.exitCode = 1
})
