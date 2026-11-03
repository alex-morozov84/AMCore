import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { failure, contextReads } = require('../ci-diagnostic.cjs')
const BrowserReporter = require('../ci-browser-reporter.cjs')
const ApiReporter = require('../api-e2e/reporter.cjs')
const location = { file: new URL(import.meta.url).pathname, line: 1, column: 1 }
const secret = 'Bearer <synthetic-secret-do-not-persist>'

test('stack locations retain only existing repository source frames; unknown data is withheld', () => {
  const result = failure({
    message: secret,
    stack: `${secret}\n at secret (${location.file}:99:3)`,
  })
  assert.equal(result.file, 'scripts/lib/ci-diagnostic.test.mjs')
  assert.equal(result.line, 99)
  assert.equal(result.column, 3)
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.equal(failure({ message: secret, matcherResult: null }).category, 'detail-withheld')
  assert.deepEqual(contextReads({ reads: { requests: [null, {}] } })[0].events, [])
  assert.deepEqual(contextReads(null), [])
})

test('context attachments expose only bounded route templates, status and known phase', () => {
  const result = contextReads({
    reads: {
      requests: [
        {
          route: `/api/product-access/organizations/${secret}?token=${secret}`,
          method: secret,
          state: secret,
          status: 403,
          body: secret,
          events: [
            { phase: 'return-alpha', ms: 12 },
            { phase: secret, ms: secret },
          ],
        },
      ],
    },
  })
  assert.equal(result[0].route, '/api/product-access/organizations/<id>')
  assert.equal(result[0].events[0].phase, 'return-alpha')
  assert.equal(result[0].status, 403)
  assert.ok(!JSON.stringify(result).includes(secret))
})

test('real Playwright reporter preserves first failure and retry pass without launching a browser', () => {
  const directory = mkdtempSync(join(tmpdir(), 'safe-ci-playwright-'))
  const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url))
  const output = join(directory, 'events.jsonl')
  try {
    writeFileSync(
      join(directory, 'case.spec.cjs'),
      `const {test,expect}=require(${JSON.stringify(webRequire.resolve('@playwright/test'))});\n` +
        `test(${JSON.stringify(secret)},async({},info)=>expect(info.retry).toBe(1));\n`
    )
    const config = join(directory, 'playwright.config.cjs')
    writeFileSync(
      config,
      `module.exports=${JSON.stringify({
        testDir: directory,
        testMatch: '*.spec.cjs',
        outputDir: join(directory, 'results'),
        retries: 1,
        workers: 1,
        reporter: [[require.resolve('../ci-browser-reporter.cjs')]],
      })}`
    )
    const text = execFileSync(
      process.execPath,
      [webRequire.resolve('@playwright/test/cli'), 'test', `--config=${config}`],
      {
        env: { ...process.env, AMCORE_CI_DIAGNOSTICS: output },
        encoding: 'utf8',
        timeout: 20_000,
      }
    )
    const saved = readFileSync(output, 'utf8')
    const rows = saved.trim().split('\n').map(JSON.parse)
    assert.deepEqual(
      rows.slice(0, 2).map((row) => [row.retry, row.status]),
      [
        [0, 'failed'],
        [1, 'passed'],
      ]
    )
    assert.equal(rows.at(-1).failed, 1)
    assert.equal(rows.at(-1).status, 'passed')
    assert.ok(!(text + saved).includes(secret))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('safe diagnostics retain numeric assertion facts and withhold arbitrary title/body/stack', () => {
  const result = failure(
    {
      message: secret,
      stack: secret,
      body: secret,
      matcherResult: { name: 'toBe', actual: 9, expected: 1 },
    },
    location
  )
  assert.equal(result.matcher, 'toBe')
  assert.equal(result.actual, 9)
  assert.equal(result.expected, 1)
  assert.equal(result.file, 'scripts/lib/ci-diagnostic.test.mjs')
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.equal(
    failure({ message: secret, matcherResult: { name: secret, actual: secret } }).category,
    'detail-withheld'
  )
  assert.equal(failure(null).category, 'detail-withheld')
  assert.equal(failure({ message: 'Test timed out' }).category, 'timeout')
})

test('first browser failure survives retry pass; secret/large attachments never enter persisted summary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'safe-ci-browser-'))
  const before = process.env.AMCORE_CI_DIAGNOSTICS
  process.env.AMCORE_CI_DIAGNOSTICS = join(directory, 'attempt1.jsonl')
  try {
    const reporter = new BrowserReporter()
    const test = { location, title: secret }
    reporter.onTestEnd(test, {
      retry: 0,
      status: 'failed',
      duration: 1,
      errors: [{ message: secret.repeat(10000), stack: secret }],
      attachments: [secret],
    })
    reporter.onTestEnd(test, { retry: 1, status: 'passed', duration: 1, errors: [] })
    for (let i = 0; i < 2000; i++)
      reporter.onTestEnd(test, { retry: 0, status: 'passed', duration: 1, errors: [] })
    reporter.onEnd({ status: 'passed' })
    const text = readFileSync(process.env.AMCORE_CI_DIAGNOSTICS, 'utf8')
    const rows = text.trim().split('\n').map(JSON.parse)
    assert.deepEqual(
      rows.slice(0, 2).map((r) => [r.retry, r.status]),
      [
        [0, 'failed'],
        [1, 'passed'],
      ]
    )
    assert.equal(rows.at(-1).failed, 1)
    assert.ok(rows.at(-1).omitted > 0)
    assert.ok(Buffer.byteLength(text) <= 64 * 1024)
    assert.ok(!text.includes(secret))
  } finally {
    if (before === undefined) delete process.env.AMCORE_CI_DIAGNOSTICS
    else process.env.AMCORE_CI_DIAGNOSTICS = before
    rmSync(directory, { recursive: true, force: true })
  }
})

test('API reporter filters before JSONL while retaining invocation and failed assertion identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'safe-ci-api-'))
  const keys = ['AMCORE_E2E_PROGRESS', 'AMCORE_E2E_ATTEMPT']
  const original = keys.map((key) => process.env[key])
  process.env.AMCORE_E2E_PROGRESS = join(directory, 'attempt.jsonl')
  process.env.AMCORE_E2E_ATTEMPT = 'attempt'
  try {
    new ApiReporter().onTestResult(
      { path: location.file },
      {
        testFilePath: location.file,
        failureMessage: secret,
        testResults: [
          {
            status: 'failed',
            invocations: 2,
            retryReasons: [secret],
            location,
            title: secret,
            failureDetails: [
              { message: secret, matcherResult: { name: 'toBe', actual: 9, expected: 1 } },
            ],
          },
        ],
      }
    )
    const text = readFileSync(process.env.AMCORE_E2E_PROGRESS, 'utf8')
    const row = JSON.parse(text)
    assert.equal(row.failure, true)
    assert.equal(row.firstError.assertion, 1)
    assert.equal(row.firstError.actual, 9)
    assert.equal(row.assertions[0].invocations, 2)
    assert.equal(row.assertions[0].retryReasons.length, 1)
    assert.ok(!text.includes(secret))
  } finally {
    keys.forEach((key, index) =>
      original[index] === undefined ? delete process.env[key] : (process.env[key] = original[index])
    )
    rmSync(directory, { recursive: true, force: true })
  }
})
