import { mkdir, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { auditPlan, invariant, digest } from '../lib/lighthouse-plan.mjs'
import { runIdentity } from './identity.mjs'
import { readViewBundle, writeView, verifyView } from '../lib/lighthouse-view-export.mjs'

const plan = auditPlan(process.cwd(), runIdentity(process.cwd()))
const expected = JSON.parse(process.env.AMCORE_EXPECTED_AUDIT_PLAN)
invariant(expected.digest === plan.digest, 'unexpected-ci-plan')
const lane = process.env.E2E_CI_LANE
invariant(plan.assignments[lane]?.length, 'unassigned-view-owner')
const output = join(process.cwd(), '.amcore/lighthouse-results', plan.run, plan.attempt, lane)
await mkdir(output, { recursive: true, mode: 0o700 })
const view = join(output, 'view')
const exists = await lstat(view).then(
  () => true,
  (error) => {
    if (error.code !== 'ENOENT') throw error
    return false
  }
)
if (exists) {
  const bundle = await readViewBundle(join(output, 'bundle'), plan, lane)
  await verifyView(view, plan, lane, bundle?.manifest, {
    archiveHash: bundle ? digest(await readFile(join(output, 'payload.json.gz'))) : undefined,
  })
} else await writeView(view, plan, lane, join(output, 'bundle'), join(output, 'payload.json.gz'))
