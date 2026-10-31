import { assertRequiredAudits, requiredAuditCategories } from './lighthouse-required.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import defaultConfig from 'lighthouse/core/config/default-config.js'
import { auditPlan, auditCatalogue, digest } from './lighthouse-plan.mjs'
import { checkCoverage } from './lighthouse-coverage.mjs'
import { evaluateResult, validateResult } from './lighthouse-policy.mjs'
import { writePair, writeManifest, verifyBundle } from './lighthouse-reports.mjs'
import { validateEnvelopes, validateOwnerBundle } from './lighthouse-ci-evidence.mjs'
import { admitCase, phaseDeadline, durations, boundedCase } from './lighthouse-deadlines.mjs'

const root = new URL('../..', import.meta.url).pathname
const identity = { run: '123', attempt: '1', source: 'a'.repeat(40) }
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-lighthouse-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
function result() {
  const categories = globalThis.structuredClone(defaultConfig.categories)
  const audits = {}
  for (const c of Object.values(categories)) {
    c.auditRefs = c.auditRefs.filter((r) => r.id !== 'interaction-to-next-paint')
    c.score = 1
    for (const { id } of c.auditRefs) audits[id] = { id, score: 1, scoreDisplayMode: 'binary' }
  }
  for (const [id, unit] of Object.entries({
    'first-contentful-paint': 'millisecond',
    'largest-contentful-paint': 'millisecond',
    'total-blocking-time': 'millisecond',
    'cumulative-layout-shift': 'unitless',
  }))
    audits[id] = { id, score: 1, scoreDisplayMode: 'numeric', numericValue: 0, numericUnit: unit }
  return {
    lighthouseVersion: '13.6.0',
    categories,
    audits,
    finalDisplayedUrl: 'https://example.test/login',
  }
}

test('green94 cannot hide a missing label; timing and SEO category score do not enforce policy', () => {
  const lhr = result()
  lhr.categories.accessibility.score = 0.94
  lhr.audits.label.score = 0
  const s = { requiredAudits: ['label'], indexable: false }
  const observation = {
    identity: true,
    requiredData: true,
    url: lhr.finalDisplayedUrl,
    indexable: false,
  }
  assert.equal(evaluateResult(lhr, s, observation).passed, false)
  lhr.audits.label.score = 1
  lhr.categories.performance.score = 0.1
  assert.equal(evaluateResult(lhr, s, observation).passed, true)
  observation.indexable = true
  assert.deepEqual(evaluateResult(lhr, s, observation).failed, ['indexing-expectation'])
})

test('invalid metrics, unknown modes, changed inventories, runtime errors and unproved identity are refused', () => {
  for (const mutate of [
    (r) => {
      r.runtimeError = {}
    },
    (r) => {
      r.audits.label.score = NaN
    },
    (r) => {
      r.audits.label.scoreDisplayMode = 'surprise'
    },
    (r) => {
      r.audits['total-blocking-time'].numericUnit = 'byte'
    },
    (r) => {
      r.categories.seo.auditRefs.pop()
    },
  ]) {
    const r = result()
    mutate(r)
    assert.throws(() => validateResult(r))
  }
  assert.throws(() =>
    evaluateResult(result(), { requiredAudits: [], indexable: false }, { identity: false })
  )
})

test('manual and informative do not silently pass required rules; unexpected N/A fails', () => {
  const r = result(),
    s = { requiredAudits: ['label'], indexable: false }
  const o = { identity: true, requiredData: true, url: r.finalDisplayedUrl, indexable: false }
  for (const mode of ['manual', 'informative', 'notApplicable']) {
    r.audits.label.scoreDisplayMode = mode
    r.audits.label.score = mode === 'informative' ? 1 : null
    assert.equal(evaluateResult(r, s, o).passed, false)
  }
})

// AMCORE_CONSOLE_LIGHTHOUSE_OWNER_TEST_START
test('owner resolver keeps one exact audit assignment in all four topologies and Console-disabled output', async (t) => {
  const { auditCommand } = await import('./lighthouse-command.mjs')
  const dir = await temporary(t)
  for (const file of [
    'PROJECT_CONTEXT.md',
    'packages/shared/src/config/product-admin.json',
    'apps/web/e2e',
    'scripts/run-console-session-e2e.mjs',
  ])
    await cp(join(root, file), join(dir, file), { recursive: true })
  const context = await readFile(join(dir, 'PROJECT_CONTEXT.md'), 'utf8')
  for (const product of ['path', 'host'])
    for (const consoleMode of ['path', 'host']) {
      await writeFile(
        join(dir, 'packages/shared/src/config/product-admin.json'),
        JSON.stringify({ mode: product, alias: 'workspace' })
      )
      await writeFile(
        join(dir, 'PROJECT_CONTEXT.md'),
        context
          .replace(
            /\*\*admin_console_mode:\*\* (?:path|host)/,
            `**admin_console_mode:** ${consoleMode}`
          )
          .replace('**admin_console_slug:** admin', '**admin_console_slug:** ops')
      )
      const p = auditPlan(dir, identity)
      for (const owner of Object.keys(p.assignments).filter((lane) => p.assignments[lane].length)) {
        const args = auditCommand(p, owner, 'audit-example')
        assert.equal(
          args[args.indexOf('--lane') + 1],
          owner === 'host'
            ? 'console-real-stack'
            : owner === 'staff-oauth'
              ? 'product-admin-real-stack'
              : 'real-stack'
        )
        assert.ok(
          args.includes('--audit-only'),
          'local audit must never launch the ordinary E2E suite'
        )
        assert.equal(args[args.indexOf('--id') + 1], 'audit-example')
      }
      assert.deepEqual(Object.values(p.assignments).flat().sort(), [
        'console-overview',
        'login',
        'members',
      ])
      assert.ok(
        p.assignments[product === 'host' ? 'staff-oauth' : 'path-standard'].includes('members')
      )
      assert.ok(
        p.assignments[consoleMode === 'host' ? 'host' : 'path-standard'].includes(
          'console-overview'
        )
      )
      assert.equal(p.assignments['setup-cli'].length, 0)
    }
  // Actual Console removal is tested through its registered initializer seam, not a false disabled context alone.
})

// AMCORE_CONSOLE_LIGHTHOUSE_OWNER_TEST_END

test('manifest-based coverage rejects missing, stale, duplicated and empty routes', () => {
  const c = auditCatalogue(root)
  const pages = c.coverage
    .map((r) =>
      r.route.replace('product-admin:', '/manage').replace('console:', '/admin').replace('app:', '')
    )
    .map((r) => r.replaceAll('//', '/'))
  const resolvers = [
    { scope: 'product-admin', prefix: '/manage' },
    { scope: 'console', prefix: '/admin' },
  ]
  assert.equal(checkCoverage(pages, c, resolvers).length, pages.length)
  assert.throws(() => checkCoverage([...pages, '/new-route'], c, resolvers))
  assert.throws(() => checkCoverage(pages.slice(1), c, resolvers))
  assert.throws(() =>
    checkCoverage(pages, { ...c, coverage: [...c.coverage, c.coverage[0]] }, resolvers)
  )
  assert.throws(() => checkCoverage([], c, resolvers))
})

test('safe report bundle round-trip refuses partial files, unknown files, symlinks and changed hashes', async (t) => {
  const dir = await temporary(t)
  const files = await writePair(dir, 'login', { json: '{}', html: '<html>safe</html>' }, [
    'secret-canary',
  ])
  await writeManifest(dir, { version: 1, files })
  const valid = await verifyBundle(dir)
  assert.ok(valid.sha256)
  await writeFile(join(dir, 'unexpected.txt'), 'secret')
  await assert.rejects(verifyBundle(dir))
  await rm(join(dir, 'unexpected.txt'))
  await writeFile(join(dir, 'login.json'), '{ }')
  await assert.rejects(verifyBundle(dir))
  await rm(join(dir, 'login.json'))
  await symlink(join(dir, 'login.html'), join(dir, 'login.json'))
  await assert.rejects(verifyBundle(dir))
  assert.equal(digest('{}'), files[0].sha256)
})

test('secret canaries, oversize, duplicate output and missing report pairs are refused before export', async (t) => {
  const dir = await temporary(t)
  await assert.rejects(
    writePair(dir, 'login', { json: 'safe', html: 'secret-canary' }, ['secret-canary'])
  )
  await assert.rejects(writePair(dir, 'login', { json: '{}' }, []))
  await assert.rejects(writePair(dir, 'login', { json: '{}', html: 'x'.repeat(8 * 1024 ** 2) }, []))
  await writePair(dir, 'login', { json: '{}', html: 'safe' }, [])
  await assert.rejects(writePair(dir, 'login', { json: '{}', html: 'safe' }, []))
})

test('expected lane evidence refuses skipped/duplicate/wrong-run owners and prior E2E failure', () => {
  const p = auditPlan(root, identity)
  const envelopes = Object.entries(p.assignments).map(([lane, ids]) => ({
    ...identity,
    lane,
    plan: p.digest,
    expected: ids,
    observed: ids,
    outcomes: {
      setup: 'passed',
      test: 'passed',
      termination: 'passed',
      cleanup: 'passed',
      originalUpload: 'passed',
      audit: ids.length ? 'passed' : 'not_applicable',
      view: ids.length ? 'passed' : 'not_applicable',
      export: ids.length ? 'passed' : 'not_applicable',
      upload: ids.length ? 'passed' : 'not_applicable',
    },
    ...(ids.length
      ? {
          artifactId: '1234',
          manifestHash: 'b'.repeat(64),
          archiveHash: 'c'.repeat(64),
          viewHash: 'd'.repeat(64),
        }
      : {}),
  }))
  const jobs = { 'web-e2e-plan': { result: 'success' }, 'web-e2e-lanes': { result: 'success' } }
  assert.ok(validateEnvelopes(p, envelopes, jobs).length)
  assert.throws(() => validateEnvelopes(p, envelopes.slice(1), jobs))
  assert.throws(() => validateEnvelopes(p, [...envelopes, envelopes[0]], jobs))
  assert.throws(() =>
    validateEnvelopes(
      p,
      envelopes.map((e) => ({ ...e, attempt: '2' })),
      jobs
    )
  )
  assert.throws(() =>
    validateEnvelopes(p, envelopes, { ...jobs, 'web-e2e-lanes': { result: 'failure' } })
  )
  assert.throws(() =>
    validateEnvelopes(
      p,
      envelopes.map((e) => ({ ...e, observed: [] })),
      jobs
    )
  )
})

test('case admission preserves export, termination and cleanup; timeout invokes owned stop', async () => {
  const epoch = 1000
  assert.equal(phaseDeadline(epoch, epoch + durations.preAudit), epoch + 35 * 60_000)
  assert.throws(() => phaseDeadline(epoch, epoch + durations.preAudit + 1))
  assert.throws(() => admitCase(1000 + durations.case + durations.export - 1, 1000))
  let stopped
  await assert.rejects(
    boundedCase(
      () => new Promise(() => {}),
      async (expired) => {
        stopped = expired
      },
      Date.now() + 10
    )
  )
  assert.equal(stopped, true)
})

test('retrieved owner evidence rejects local-only proof, changed build sources and incomplete results', () => {
  const plan = auditPlan(root, identity)
  const ids = plan.assignments['path-standard']
  const provenance = { lock: 'b'.repeat(64), content: 'c'.repeat(64), tooling: 'd'.repeat(64) }
  const envelope = { lane: 'path-standard' }
  const manifest = {
    ...identity,
    ...provenance,
    version: 1,
    plan: plan.digest,
    lane: envelope.lane,
    priorTests: 'passed',
    localAudit: false,
    config: plan.config,
    descriptors: plan.descriptors,
    build: 'actual-build',
    coverage: { rows: [{}], digest: 'e'.repeat(64) },
    results: ids.map((id) => ({
      id,
      valid: true,
      identity: true,
      requiredData: true,
      policy: { passed: true },
    })),
    files: ids.flatMap((id) => [{ name: `${id}.json` }, { name: `${id}.html` }]),
  }
  assert.equal(validateOwnerBundle(plan, envelope, manifest, provenance), true)
  for (const key of ['lock', 'content', 'tooling'])
    assert.throws(
      () => validateOwnerBundle(plan, envelope, { ...manifest, [key]: 'f'.repeat(64) }, provenance),
      /build-provenance-mismatch/
    )
  assert.throws(
    () => validateOwnerBundle(plan, envelope, { ...manifest, localAudit: true }, provenance),
    /local-audit-is-not-ci-e2e-evidence/
  )
  assert.throws(
    () => validateOwnerBundle(plan, envelope, { ...manifest, priorTests: 'failed' }, provenance),
    /local-audit-is-not-ci-e2e-evidence/
  )
  assert.throws(
    () =>
      validateOwnerBundle(
        plan,
        envelope,
        { ...manifest, results: manifest.results.slice(1) },
        provenance
      ),
    /wrong-bundle-scenarios/
  )
  assert.throws(
    () =>
      validateOwnerBundle(
        plan,
        envelope,
        { ...manifest, results: manifest.results.map((r) => ({ ...r, requiredData: false })) },
        provenance
      ),
    /invalid-owner-result/
  )
})

test('required HTTPS fails at zero and passes only after restoration, outside accessibility', () => {
  const r = result(),
    s = { requiredAudits: ['is-on-https'], indexable: false }
  const o = { identity: true, requiredData: true, url: r.finalDisplayedUrl, indexable: false }
  r.audits['is-on-https'].score = 0
  assert.deepEqual(evaluateResult(r, s, o).failed, ['is-on-https'])
  r.audits['is-on-https'].score = 1
  assert.equal(evaluateResult(r, s, o).passed, true)
  for (const mode of ['numeric', 'metricSavings']) {
    r.audits['is-on-https'].scoreDisplayMode = mode
    assert.throws(() => evaluateResult(r, s, o), /unsupported-required-audit-mode/)
  }
})

test('mandatory registry matches pinned non-performance categories and rejects unsupported descriptors', async (t) => {
  for (const [id, category] of Object.entries(requiredAuditCategories)) {
    assert.ok(defaultConfig.categories[category].auditRefs.some((ref) => ref.id === id))
    assert.ok(!defaultConfig.categories.performance.auditRefs.some((ref) => ref.id === id))
  }
  for (const ids of [
    ['label', 'label'],
    ['largest-contentful-paint'],
    ['image-delivery-insight'],
    ['unadmitted-rule'],
    [null],
  ])
    assert.throws(() => assertRequiredAudits(ids), /unsupported-required-audits/)
  const dir = await temporary(t)
  const catalogue = await readFile(join(root, 'apps/web/e2e/lighthouse/catalogue.json'), 'utf8')
  await cp(join(root, 'apps/web/e2e/lighthouse'), join(dir, 'apps/web/e2e/lighthouse'), {
    recursive: true,
  })
  for (const ids of [['largest-contentful-paint'], ['unadmitted-rule']]) {
    const bad = JSON.parse(catalogue)
    bad.scenarios[0].requiredAudits = ids
    await writeFile(join(dir, 'apps/web/e2e/lighthouse/catalogue.json'), JSON.stringify(bad))
    assert.throws(() => auditCatalogue(dir, { extensions: [] }), /unsupported-required-audits/)
  }
})
