import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runShard } from '../api-e2e/run.mjs'

export async function exerciseRun(change = () => {}, { executionError, cleanupError } = {}) {
  const output = mkdtempSync(join(tmpdir(), 'api-e2e-lane-'))
  const paths = ['test/first.e2e-spec.ts', 'test/second.e2e-spec.ts']
  const spawned = [],
    ledger = new Map()
  const services = {
    supervise: async (_command, args, options) => {
      spawned.push(args.at(-1))
      if (executionError) throw new Error(executionError)
      const id = options.env.AMCORE_E2E_ATTEMPT,
        pid = 100 + spawned.length
      const failed = spawned.length === 1,
        path = args.at(-1)
      const result = {
        pid,
        spawns: 1,
        closed: true,
        exit: failed ? 1 : 0,
        signal: null,
        forced: false,
        lifecycleFailure: false,
      }
      const data = {
        result,
        final: { success: !failed },
        rows: [
          { event: 'run-start', attempt: id, pid },
          { event: 'suite-start', attempt: id, pid, path },
          {
            event: 'suite-end',
            attempt: id,
            pid,
            path,
            runtimeError: false,
            failure: failed,
            assertions: [
              { status: failed ? 'failed' : 'passed', invocations: 1, retryReasons: [] },
            ],
          },
          { event: 'terminal', attempt: id, pid, success: !failed },
        ],
      }
      if (failed) change(data)
      ledger.set(options.progress, data.rows)
      writeFileSync(options.env.AMCORE_E2E_FINAL, JSON.stringify(data.final))
      return data.result
    },
    readRows: (path) => ledger.get(path),
    cleanOwned: async () => {
      if (cleanupError) throw new Error(cleanupError)
      return true
    },
  }
  try {
    await runShard(
      { sha: 'a'.repeat(40), run: 'local', runAttempt: '1', pullRequestHead: null },
      { id: '1/1', paths },
      output,
      services
    ).catch(() => {})
    return { spawned, report: JSON.parse(readFileSync(join(output, 'report.json'))) }
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
}
