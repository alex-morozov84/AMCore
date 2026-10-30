import { snapshot } from '../stand/snapshot.mjs'
import { toolingFingerprint } from './reuse.mjs'
import { readdir, readFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { auditPlan, auditCatalogue, invariant, digest } from '../lib/lighthouse-plan.mjs'
import { runIdentity } from './identity.mjs'
import { validateEnvelopes, validateOwnerBundle } from '../lib/lighthouse-ci-evidence.mjs'
import { unpackReports } from '../lib/lighthouse-archive.mjs'
import { checkCoverage } from '../lib/lighthouse-coverage.mjs'

const plan = auditPlan(process.cwd(), runIdentity(process.cwd()))
invariant(
  JSON.parse(process.env.AMCORE_EXPECTED_AUDIT_PLAN).digest === plan.digest,
  'unexpected-ci-plan'
)
const root = '.amcore/lighthouse-downloads'
const directories = await readdir(join(root, 'status'))
const statuses = await Promise.all(
  directories.map(async (dir) => {
    const names = await readdir(join(root, 'status', dir))
    invariant(names.length === 1 && names[0] === 'status.json', 'unexpected-envelope-files')
    const e = JSON.parse(await readFile(join(root, 'status', dir, 'status.json'), 'utf8'))
    invariant(
      dir === `web-e2e-lane-${plan.run}-${plan.attempt}-${e.lane}`,
      'unexpected-envelope-name'
    )
    return e
  })
)
const owners = validateEnvelopes(plan, statuses, JSON.parse(process.env.E2E_RESULTS))
if (process.argv.includes('--envelopes')) {
  invariant(process.env.GITHUB_OUTPUT, 'missing-ci-output')
  appendFileSync(process.env.GITHUB_OUTPUT, `ids=${owners.map((e) => e.artifactId).join(',')}\n`)
} else {
  const expectedNames = owners.map((e) => `web-lighthouse-${plan.run}-${plan.attempt}-${e.lane}`)
  invariant(
    JSON.stringify((await readdir(join(root, 'bundles'))).sort()) ===
      JSON.stringify(expectedNames.sort()),
    'unexpected-owner-artifact-set'
  )
  const catalogue = auditCatalogue(process.cwd(), plan.choices)
  const resolvers = [{ scope: 'product-admin', prefix: `/${plan.choices.productAdmin.alias}` }]
  // AMCORE_CONSOLE_LIGHTHOUSE_AGGREGATE_START
  resolvers.push({ scope: 'console', prefix: `/${plan.choices.console.slug}` })
  // AMCORE_CONSOLE_LIGHTHOUSE_AGGREGATE_END
  const provenance = {
    lock: digest(await readFile('pnpm-lock.yaml')),
    content: await snapshot(process.cwd()),
    tooling: await toolingFingerprint(process.cwd()),
  }
  for (const e of owners) {
    const location = join(root, 'bundles', `web-lighthouse-${plan.run}-${plan.attempt}-${e.lane}`)
    invariant(
      JSON.stringify(await readdir(location)) === JSON.stringify(['payload.json.gz']),
      'unexpected-artifact-files'
    )
    const bundle = await unpackReports(
      join(location, 'payload.json.gz'),
      join(location, 'verified'),
      e.archiveHash,
      e.manifestHash
    )
    invariant(bundle.sha256 === e.manifestHash, 'wrong-retrieved-manifest')
    validateOwnerBundle(plan, e, bundle.manifest, provenance)
    const coverage = checkCoverage(bundle.manifest.coverage.pages, catalogue, resolvers)
    invariant(digest(coverage) === bundle.manifest.coverage.digest, 'unverified-coverage')
  }
  console.log('Every original lane and exact owning audit bundle passed retrieval and validation')
}
