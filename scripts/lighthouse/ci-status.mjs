import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { auditPlan, invariant, digest } from '../lib/lighthouse-plan.mjs'
import { runIdentity } from './identity.mjs'
import { readViewBundle, verifyView } from '../lib/lighthouse-view-export.mjs'
import { resultSummary } from '../lib/lighthouse-view-summary.mjs'
import { artifactUrl } from '../lib/lighthouse-view-model.mjs'

const root = process.cwd()
const plan = auditPlan(root, runIdentity(root))
invariant(
  JSON.parse(process.env.AMCORE_EXPECTED_AUDIT_PLAN).digest === plan.digest,
  'unexpected-ci-plan'
)
const lane = process.env.E2E_CI_LANE
const expected = plan.assignments[lane]
invariant(expected, 'unknown-status-lane')
const output = join(root, '.amcore/lighthouse-results', plan.run, plan.attempt, lane)
await mkdir(output, { recursive: true, mode: 0o700 })
const lifecycle = await readFile(join(output, 'lifecycle.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => ({}))
const pass = (value) => (value === 'success' ? 'passed' : 'failed')
const outcomes = {
  setup: lifecycle.setup ?? 'failed',
  test: lifecycle.test ?? 'failed',
  termination: lifecycle.termination ?? 'failed',
  cleanup: lifecycle.cleanup ?? 'failed',
  audit: expected.length ? 'not_run_prior_failure' : 'not_applicable',
  export: expected.length ? 'failed' : 'not_applicable',
  view: expected.length ? 'failed' : 'not_applicable',
  upload: expected.length ? 'failed' : 'not_applicable',
  originalUpload: pass(process.env.ORIGINAL_UPLOAD),
}
let bundle, view, url
try {
  bundle = await readViewBundle(join(output, 'bundle'), plan, lane)
} catch {
  /* Missing/invalid evidence remains a failure. */
}
if (bundle) {
  outcomes.audit = bundle.manifest.results.every((r) => r.valid && r.policy?.passed === true)
    ? 'passed'
    : 'failed'
  outcomes.export = 'passed'
  outcomes.upload = pass(process.env.AUDIT_UPLOAD)
}
if (expected.length) {
  try {
    view = await verifyView(join(output, 'view'), plan, lane, bundle?.manifest, {
      archiveHash: bundle ? digest(await readFile(join(output, 'payload.json.gz'))) : undefined,
    })
    outcomes.view = 'passed'
    if (process.env.AUDIT_UPLOAD === 'success') {
      url = artifactUrl(
        process.env.AUDIT_ARTIFACT_URL,
        plan,
        process.env.GITHUB_REPOSITORY,
        process.env.GITHUB_SERVER_URL
      )
      invariant(url.endsWith(`/${process.env.AUDIT_ARTIFACT_ID}`), 'artifact-url-id-mismatch')
    }
  } catch {
    url = undefined
    outcomes.view = 'failed'
  }
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    resultSummary(plan, lane, bundle?.manifest, url)
  )
}
const status = {
  version: 1,
  run: plan.run,
  attempt: plan.attempt,
  source: plan.source,
  plan: plan.digest,
  lane,
  expected,
  observed: bundle?.manifest.results.map((r) => r.id) ?? [],
  outcomes,
  ...(view ? { viewHash: view.indexHash } : {}),
  ...(bundle && process.env.AUDIT_ARTIFACT_ID
    ? {
        artifactId: process.env.AUDIT_ARTIFACT_ID,
        manifestHash: bundle.sha256,
        archiveHash: digest(await readFile(join(output, 'payload.json.gz'))),
      }
    : {}),
}
await writeFile(join(output, 'status.json'), JSON.stringify(status, null, 2), { mode: 0o600 })
