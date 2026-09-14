// Small shared helpers for running one instrumented `pnpm` stage and saving
// its diagnostics on failure — split out of instrumented-run.mjs to keep
// that file under the repo's line-count guidance.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DIAGNOSTICS_DIR = path.resolve('tmp/scaffolding-baseline/diagnostics')

export function runPnpm(root, args) {
  const start = performance.now()
  const result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8' })
  return {
    label: args.join(' '),
    ok: result.status === 0,
    durationMs: performance.now() - start,
    ranAt: new Date().toISOString(),
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

/** Saves a failed stage's captured output and returns a path relative to the repo root (never absolute). */
export function saveDiagnostics(scenarioName, stage) {
  mkdirSync(DIAGNOSTICS_DIR, { recursive: true })
  const safeLabel = stage.label.replace(/[^\w-]+/g, '_')
  const file = path.join(DIAGNOSTICS_DIR, `${scenarioName}-${safeLabel}.log`)
  writeFileSync(file, stage.output ?? '')
  return path.relative(process.cwd(), file)
}

/** Maps a pnpm command's args to the counter bucket it contributes to, or `null` if none apply. */
export function bucketFor(args) {
  if (args[0] === 'typecheck') return 'typecheckRuns'
  if (args[0] === 'lint') return 'lintRuns'
  if (args.includes('build')) return 'buildRuns'
  if (args.includes('test')) return 'testRuns'
  return null
}
