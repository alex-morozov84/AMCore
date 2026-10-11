import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { api, root, jest } from './paths.mjs'
import { supervise, readRows } from './process.mjs'
import { cleanOwned } from './resources.mjs'
import { validateAttempt } from './validate.mjs'

export async function runShard(plan, shard, output) {
  mkdirSync(output, { recursive: true })
  const report = {
    schemaVersion: 1,
    pullRequestHead: plan.pullRequestHead,
    inputs: plan.inputs,
    sha: plan.sha,
    run: plan.run,
    runAttempt: plan.runAttempt,
    shard: shard.id,
    paths: shard.paths,
    attempts: [],
    success: false,
  }
  const reportPath = resolve(output, 'report.json')
  const run = randomUUID()
  for (const path of shard.paths) {
    const began = performance.now()
    const id = randomUUID()
    const progress = resolve(output, `${id}.jsonl`)
    const final = resolve(output, `${id}.json`)
    const absolutePath = resolve(api, path)
    const env = {
      ...process.env,
      AMCORE_E2E_ATTEMPT: id,
      AMCORE_E2E_RUN: run,
      AMCORE_E2E_PROGRESS: progress,
      AMCORE_E2E_FINAL: final,
      TESTCONTAINERS_REUSE_ENABLE: 'false',
    }
    delete env.NODE_PATH
    const args = [
      '--max-old-space-size=1024',
      '--experimental-vm-modules',
      jest,
      '--config',
      'jest-e2e.config.js',
      '--ci',
      '--runInBand',
      '--reporters',
      resolve(root, 'scripts/api-e2e/reporter.cjs'),
      '--runTestsByPath',
      absolutePath,
    ]
    console.log(`API E2E ${shard.id}: ${path}`)
    const attempt = { id, path, absolutePath, run, rows: [], clean: false, spawns: 0 }
    report.attempts.push(attempt)
    const persist = () => writeFileSync(reportPath, JSON.stringify(report))
    persist()
    try {
      Object.assign(
        attempt,
        await supervise(process.execPath, args, {
          cwd: api,
          env,
          progress,
          onState: (state) => {
            Object.assign(attempt, state)
            persist()
          },
        })
      )
      attempt.rows = readRows(progress)
      attempt.final = JSON.parse(readFileSync(final, 'utf8'))
    } catch (error) {
      attempt.lifecycleFailure = true
      attempt.diagnostic = error.message
    }
    try {
      attempt.clean = await cleanOwned(run, id)
      if (!attempt.clean) attempt.lifecycleFailure = true
      if (attempt.forced || attempt.lifecycleFailure || !attempt.closed)
        await cleanOwned(run, id, true)
    } catch (error) {
      attempt.lifecycleFailure = true
      attempt.diagnostic = error.message
    }
    try {
      validateAttempt(attempt)
    } catch {
      const ordinaryFailure =
        attempt.exit === 1 &&
        attempt.closed &&
        !attempt.forced &&
        !attempt.lifecycleFailure &&
        !attempt.signal &&
        attempt.clean &&
        attempt.final?.success === false &&
        attempt.rows.some(
          (row) =>
            row.event === 'suite-end' &&
            !row.runtimeError &&
            row.assertions.some((test) => test.status === 'failed')
        )
      if (!ordinaryFailure) attempt.lifecycleFailure = true
    }
    attempt.milliseconds = performance.now() - began
    attempt.parentRss = process.memoryUsage().rss
    persist()
    if (attempt.forced || attempt.lifecycleFailure || !attempt.closed || attempt.signal) break
  }
  try {
    if (report.attempts.length !== shard.paths.length) throw new Error('Incomplete shard')
    for (const attempt of report.attempts) validateAttempt(attempt)
    report.success = true
  } finally {
    writeFileSync(reportPath, JSON.stringify(report))
  }
  return report
}
