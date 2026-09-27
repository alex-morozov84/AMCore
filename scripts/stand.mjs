import { snapshot } from './stand/snapshot.mjs'
import { refresh } from './stand/refresh.mjs'
import { randomUUID } from 'node:crypto'
import { create } from './stand/create.mjs'
import { root, load, lease, save } from './stand/state.mjs'
import { boot } from './stand/boot.mjs'
import { cleanup, dataAdmission } from './stand/ownership.mjs'
import { test } from './stand/playwright.mjs'
import { stopChildren, setJournal, requestCancellation, allowCleanup } from './stand/process.mjs'

const [action = 'help', ...args] = process.argv.slice(2)
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
const lane = value('--lane', 'real-stack')
const id = value('--id', action === 'e2e' ? `e2e-${randomUUID()}` : 'preview')
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    interrupted = true
    requestCancellation()
    process.exitCode = signal === 'SIGINT' ? 130 : 143
    await stopChildren()
  })
async function execute() {
  if (action === 'help') {
    console.log(
      'pnpm stand up|preview|e2e|status|list|down|recover|closeout [--id ID] [--purge]\ne2e --lane mocked|real-stack|console-real-stack\nManaged local stands; never owner .env. Native pnpm dev is outside these guards.'
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
    await recover(id, args.includes('--purge'))
    return
  }
  if (!['up', 'preview', 'e2e', 'down'].includes(action)) throw new Error('Unknown stand action')
  if (!['mocked', 'real-stack', 'console-real-stack'].includes(lane))
    throw new Error('Unknown lane')
  if (action !== 'e2e' && lane === 'mocked') throw new Error('Mocked lane is e2e-only')
  const held = await lease(id, action)
  setJournal(`${root}/.amcore/stands/${id}/lease/children.json`)
  let m
  try {
    if (action === 'down') {
      m = await load(id, args.includes('--orphan'))
      await cleanup(m, args.includes('--purge'))
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
      if (action === 'e2e' && (existing.topology === 'host') !== (lane === 'console-real-stack'))
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
        lane === 'console-real-stack' ? 'host' : undefined,
        action === 'e2e' && lane === 'mocked'
      )
    if (lane !== 'mocked') await boot(m, !existing)
    if (interrupted) throw new Error('Interrupted startup')
    if (action === 'e2e') {
      const extra = args.includes('--') ? args.slice(args.indexOf('--') + 1) : []
      if (extra.some((arg) => /^(--config|--output|--global)/.test(arg)))
        throw new Error('Managed configuration cannot be overridden')
      if (args.includes('--proxy-smoke')) {
        if (lane !== 'console-real-stack') throw new Error('Proxy smoke requires host lane')
        const { proxySmoke } = await import('./stand/proxy-smoke.mjs')
        await proxySmoke(m)
      } else await test(m, lane, held.token, extra)
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
        await cleanup(m, true)
      } catch (e) {
        m.state = 'cleanup-failed'
        await save(m)
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
