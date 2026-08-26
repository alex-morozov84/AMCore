// Post-apply, read-only verification (FINAL PLAN, Safety model point 7):
// "this is the bar for 'coherent output', not an afterthought a human/agent
// is expected to run separately." init:brand only ever writes JSON (always
// syntactically valid via JSON.stringify) and known single-line TS/JS
// literals, so `typecheck` + `lint` catch the realistic failure modes;
// `init:project`'s heavier structural transforms add build/Storybook steps
// to this list when they land.
import { spawnSync } from 'node:child_process'

const VERIFY_STEPS = [
  { label: 'typecheck', args: ['typecheck'] },
  { label: 'lint', args: ['lint'] },
]

export function runVerification(cwd) {
  return VERIFY_STEPS.map(({ label, args }) => {
    const result = spawnSync('pnpm', args, { cwd, encoding: 'utf8' })
    return {
      label,
      ok: result.status === 0,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    }
  })
}
