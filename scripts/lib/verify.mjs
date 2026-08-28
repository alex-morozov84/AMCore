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
//
// Deliberately never runs `pnpm install`: this module runs as part of the
// real `init:project`/`init:brand` CLIs against a fork the owner already
// has installed, and a migration tool reaching out to the network and
// rewriting node_modules on every real run is its own hazard, independent
// of whether trimming it helps. A disposable test copy with no
// node_modules is the test harness's own setup problem — see
// init-project.test.mjs, which installs once before invoking the CLI.
import { spawnSync } from 'node:child_process'

const VERIFY_STEPS = [
  { label: 'typecheck', args: ['typecheck'] },
  { label: 'lint', args: ['lint'] },
]

const PROJECT_VERIFY_STEPS = [
  ...VERIFY_STEPS,
  { label: 'web build', args: ['--filter', 'web', 'build'] },
  { label: 'api test', args: ['--filter', 'api', 'test'] },
  { label: 'web test', args: ['--filter', 'web', 'test'] },
]

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
