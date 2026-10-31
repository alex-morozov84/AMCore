import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { auditPlan, digest } from './lighthouse-plan.mjs'
import { writePair, writeManifest, limits } from './lighthouse-reports.mjs'
import { packReports, unpackReports } from './lighthouse-archive.mjs'
import { readViewBundle, writeView, verifyView } from './lighthouse-view-export.mjs'
import { viewRows, artifactUrl } from './lighthouse-view-model.mjs'
import { expectedSummary, resultSummary } from './lighthouse-view-summary.mjs'
import { renderIndex } from './lighthouse-view-html.mjs'

const identity = { run: '123', attempt: '2', source: 'a'.repeat(40) }
const plan = {
  ...identity,
  digest: 'b'.repeat(64),
  assignments: { first: ['login'], silent: ['members'] },
  pages: [
    { id: 'login', label: 'Sign-in <unsafe> | [link]', path: '/login' },
    { id: 'members', label: 'Organization members', path: '/organizations/[id]/members' },
  ],
}
async function fixture(t, passed = true) {
  const root = await mkdtemp(join(tmpdir(), 't084-view-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bundle = join(root, 'bundle'),
    archive = join(root, 'payload.json.gz'),
    view = join(root, 'view')
  const html =
    '<!doctype html><html lang="en"><title>Full report</title><body>Audit detail</body></html>\n'
  const files = await writePair(bundle, 'login', { html, json: '{}' }, [])
  const manifest = {
    ...identity,
    version: 1,
    plan: plan.digest,
    lane: 'first',
    files,
    results: [
      {
        id: 'login',
        valid: true,
        identity: true,
        requiredData: true,
        policy: {
          passed,
          scores: { performance: 0.5, accessibility: 0.94, 'best-practices': 1, seo: 0.6 },
        },
      },
    ],
  }
  const manifestHash = await writeManifest(bundle, manifest)
  const archiveHash = await packReports(bundle, archive)
  const result = await writeView(view, plan, 'first', bundle, archive)
  return { root, bundle, archive, view, html, manifest, manifestHash, archiveHash, result }
}

test('native HTML stays byte-identical and policy failures remain readable with four scores', async (t) => {
  const f = await fixture(t, false)
  assert.equal(await readFile(join(f.view, 'login.html'), 'utf8'), f.html)
  const index = await readFile(join(f.view, 'index.html'), 'utf8')
  for (const text of [
    'Audit failures',
    'Performance',
    'Accessibility',
    'Best Practices',
    'SEO',
    'login.html',
  ])
    assert.ok(index.includes(text))
  assert.ok(!index.includes('<unsafe>'))
  assert.equal(
    f.result.bytes,
    (await Promise.all((await readdir(f.view)).map((n) => readFile(join(f.view, n))))).reduce(
      (s, b) => s + b.length,
      0
    )
  )
  const received = await unpackReports(
    join(f.view, 'payload.json.gz'),
    join(f.root, 'retrieved'),
    f.archiveHash,
    f.manifestHash
  )
  await verifyView(f.view, plan, 'first', received.manifest, {
    archiveHash: f.archiveHash,
    indexHash: f.result.indexHash,
  })
})

test('modified index, native report, unexpected files and symlinks cannot validate', async (t) => {
  const f = await fixture(t)
  for (const name of ['index.html', 'login.html']) {
    const before = await readFile(join(f.view, name))
    await writeFile(join(f.view, name), 'changed')
    await assert.rejects(verifyView(f.view, plan, 'first', f.manifest))
    await writeFile(join(f.view, name), before)
  }
  await writeFile(join(f.view, 'extra.txt'), 'x')
  await assert.rejects(verifyView(f.view, plan, 'first', f.manifest))
  await rm(join(f.view, 'extra.txt'))
  await rm(join(f.view, 'login.html'))
  await symlink(join(f.bundle, 'login.html'), join(f.view, 'login.html'))
  await assert.rejects(verifyView(f.view, plan, 'first', f.manifest))
  await assert.rejects(writeView(f.view, plan, 'first', f.bundle, f.archive))
})

test('the independent expected inventory includes a completely absent owner without inventing a result', async (t) => {
  const f = await fixture(t)
  const expected = expectedSummary(plan)
  assert.ok(expected.includes('Organization members'))
  assert.ok(expected.includes('silent'))
  assert.ok(expected.includes('Result unavailable / run incomplete'))
  assert.ok(!expected.includes('<unsafe>'))
  const observed = resultSummary(plan, 'first', f.manifest, undefined)
  assert.ok(!observed.includes('Organization members'))
  assert.equal(await readViewBundle(join(f.root, 'silent'), plan, 'silent'), undefined)
  assert.ok(!(await readdir(f.root)).includes('silent'))
  const rows = viewRows(plan, 'silent')
  assert.equal(rows[0].status, 'Not run')
  assert.equal(rows[0].scores, undefined)
  assert.equal(rows[0].filename, undefined)
})

test('invalid and diagnostic-only outputs never link a fabricated full report', async (t) => {
  const f = await fixture(t)
  const manifest = { ...f.manifest, files: [], results: [{ id: 'login', valid: false }] }
  const rows = viewRows(plan, 'first', manifest)
  assert.equal(rows[0].status, 'Invalid')
  assert.ok(!renderIndex(plan, 'first', rows).includes('href='))
  assert.throws(() => viewRows(plan, 'first', { ...manifest, files: f.manifest.files }))
  const view = join(f.root, 'diagnostic')
  await writeView(view, plan, 'first', join(f.root, 'missing'), f.archive)
  assert.deepEqual(await readdir(view), ['index.html'])
  assert.match(await readFile(join(view, 'index.html'), 'utf8'), /Not run/)
})

test('paths, foreign attempts, incomplete pairs, unsafe URLs and unproved identity fail closed', async (t) => {
  const f = await fixture(t)
  for (const id of ['index', '../escape', 'a.html', '/absolute'])
    assert.throws(() =>
      viewRows({ ...plan, assignments: { first: [id] }, pages: [{ id }] }, 'first')
    )
  for (const change of [
    { attempt: '1' },
    { files: f.manifest.files.slice(1) },
    { results: [{ ...f.manifest.results[0], identity: false }] },
  ])
    assert.throws(() => viewRows(plan, 'first', { ...f.manifest, ...change }))
  const url = 'https://github.com/example/repo/actions/runs/123/artifacts/456'
  assert.equal(artifactUrl(url, plan, 'example/repo'), url)
  for (const wrong of [
    url.replace('123', '999'),
    url.replace('github.com', 'evil.test'),
    `${url}/789`,
    `${url}?x=1`,
    'javascript:alert(1)',
  ])
    assert.throws(() => artifactUrl(wrong, plan, 'example/repo'))
})

test('physical upload totals include payload, copied HTML and index within unchanged limits', async (t) => {
  const f = await fixture(t)
  const before = limits.total
  try {
    limits.total = f.result.bytes - 1
    await assert.rejects(
      verifyView(f.view, plan, 'first', f.manifest),
      /view-upload-limit-exceeded/
    )
    await assert.rejects(writeView(join(f.root, 'too-large'), plan, 'first', f.bundle, f.archive))
  } finally {
    limits.total = before
  }
  assert.equal(limits.total, 256 * 1024 ** 2)
  assert.equal(limits.files, 200)
})

test('aggregate explains unavailable planning before rejecting original failure with built-ins only', async (t) => {
  const f = await fixture(t)
  const root = new URL('../..', import.meta.url)
  const jobs = parse(await readFile(new URL('.github/workflows/ci.yml', root), 'utf8')).jobs
  const script = jobs['web-e2e'].steps
    .find((s) => s.name === 'Require every planned E2E lane to succeed')
    .run.replace('node -e ', '')
    .trim()
    .slice(1, -1)
  const actual = auditPlan(root.pathname, identity)
  for (const candidate of [
    '',
    JSON.stringify({ ...actual, attempt: '1' }),
    JSON.stringify({ ...actual, digest: '0'.repeat(64) }),
  ]) {
    const summary = join(f.root, `summary-${digest(candidate)}`)
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: {
        E2E_RESULTS: JSON.stringify({
          'web-e2e-plan': { result: 'failure' },
          'web-e2e-lanes': { result: 'skipped' },
        }),
        AMCORE_EXPECTED_AUDIT_PLAN: candidate,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_RUN_ID: identity.run,
        GITHUB_RUN_ATTEMPT: identity.attempt,
        GITHUB_SHA: identity.source,
      },
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(await readFile(summary, 'utf8'), /coverage unavailable/)
  }
  assert.equal(jobs['web-e2e-plan'].steps.at(-1).run, 'node scripts/e2e-ci.mjs --plan-ci')
  assert.ok(
    jobs['web-e2e-lanes'].steps.find((s) => s.id === 'audit-upload').with.path.endsWith('/view/')
  )
  assert.deepEqual(
    [jobs['web-e2e-plan']['timeout-minutes'], jobs['web-e2e']['timeout-minutes']],
    [5, 5]
  )
})
