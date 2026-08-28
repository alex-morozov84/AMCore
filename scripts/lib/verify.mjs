// Post-apply, read-only verification (FINAL PLAN, Safety model point 7):
// "this is the bar for 'coherent output', not an afterthought a human/agent
// is expected to run separately." init:brand only ever writes JSON (always
// syntactically valid via JSON.stringify) and known single-line TS/JS
// literals, so `typecheck` + `lint` catch the realistic failure modes.
// init:project's heavier structural transform adds a real `web build` and
// the plain (infra-free) unit-test suites — `typecheck`/`lint` alone missed
// a real class of defect here: a narrowed SUPPORTED_LOCALES can leave a spec
// asserting runtime behavior (e.g. "'ru' is a valid locale") that no longer
// holds, with nothing in the type system to catch it. `test:e2e` stays out
// on purpose — it needs Docker/Testcontainers, which this verification step
// cannot assume is available.
import { spawnSync } from 'node:child_process'

const VERIFY_STEPS = [
  { label: 'typecheck', args: ['typecheck'] },
  { label: 'lint', args: ['lint'] },
]

const PROJECT_VERIFY_STEPS = [
  { label: 'install', args: ['install'] },
  ...VERIFY_STEPS,
  { label: 'web build', args: ['--filter', 'web', 'build'] },
  { label: 'api test', args: ['--filter', 'api', 'test'] },
  { label: 'web test', args: ['--filter', 'web', 'test'] },
]

// CI=true: on a disposable copy whose node_modules doesn't match the
// lockfile bit-for-bit (e.g. it doesn't exist yet), pnpm's own deps-status
// check aborts asking for an interactive confirmation rather than just
// reinstalling — harmless to set unconditionally, since it is a no-op
// against an already-consistent checkout. The explicit 'install' step in
// PROJECT_VERIFY_STEPS exists because relying only on each later command's
// own implicit deps-status-check proved unreliable under concurrent runs
// (a later step could still report "node_modules missing" even with CI=true
// set) — an explicit, checked install step surfaces that failure as its own
// labelled result instead of a confusing cascade of "command not found."
function runSteps(cwd, steps) {
  return steps.map(({ label, args }) => {
    const result = spawnSync('pnpm', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    })
    return {
      label,
      ok: result.status === 0,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    }
  })
}

export function runVerification(cwd) {
  return runSteps(cwd, VERIFY_STEPS)
}

export function runProjectVerification(cwd) {
  return runSteps(cwd, PROJECT_VERIFY_STEPS)
}
