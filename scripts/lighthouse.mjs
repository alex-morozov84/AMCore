import { auditCommand, auditEnvironment } from './lib/lighthouse-command.mjs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { auditPlan, invariant } from './lib/lighthouse-plan.mjs'
import { runIdentity } from './lighthouse/identity.mjs'
import { run, cleanEnvironment } from './stand/process.mjs'

const root = import.meta.dirname + '/..'
const plan = auditPlan(root, runIdentity(root))
const requested = process.argv[2]
if (requested === '--plan') console.log(JSON.stringify(plan, null, 2))
else {
  const lane = requested ?? 'path-standard'
  invariant(plan.assignments[lane]?.length, 'select-an-audit-owning-lane')
  invariant(!process.env.CI, 'local-audit-command-is-not-ci-bypass')
  const reuseIndex = process.argv.indexOf('--reuse')
  const standId = reuseIndex >= 0 ? process.argv[reuseIndex + 1] : `audit-${randomUUID()}`
  const args = auditCommand(plan, lane, standId, reuseIndex >= 0)
  console.log(`Audit stand: ${standId}`)
  const output = join(root, '.amcore/lighthouse-results', plan.run, plan.attempt, lane, 'bundle')
  const controller = new globalThis.AbortController()
  const handlers = new Map(
    ['SIGINT', 'SIGTERM'].map((name) => [
      name,
      () => {
        process.exitCode = name === 'SIGINT' ? 130 : 143
        controller.abort(name)
      },
    ])
  )
  for (const [name, handler] of handlers) process.once(name, handler)
  try {
    await run(process.execPath, args, {
      cwd: root,
      graceful: true,
      signal: controller.signal,
      env: cleanEnvironment({
        ...auditEnvironment(plan, lane, Date.now(), output),
        ...(process.argv.includes('--acceptance') ? { AMCORE_AUDIT_ACCEPTANCE: 'true' } : {}),
      }),
    })
  } catch {
    console.error(`Audit failed; inspect the safe manifest at ${output}. Stand: ${standId}`)
    process.exitCode ||= 1
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler)
  }
  if (!process.exitCode) console.log(`Validated local Lighthouse reports: ${output}`)
}
