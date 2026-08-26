#!/usr/bin/env node
// `pnpm init:brand` (Track 10, ADR-071) — repeatable, non-destructive brand/
// identity initializer for a downstream fork. See ai/models-talk.md's FINAL
// PLAN and ai/decisions/adr-071-*.md for the full design.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCommonFlags, runInitCommand } from './lib/init-engine.mjs'
import { collectAnswers, BRAND_FLAG_OPTIONS } from './lib/brand-fields.mjs'
import { buildBrandSteps } from './lib/brand-plan.mjs'

// AMCORE_INIT_ROOT lets tests point the real entrypoint at a disposable
// fixture tree instead of the actual repo; unset in normal use.
const ROOT = process.env.AMCORE_INIT_ROOT
  ? path.resolve(process.env.AMCORE_INIT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const flags = parseCommonFlags(process.argv.slice(2), BRAND_FLAG_OPTIONS)
  const answers = await collectAnswers({ root: ROOT, flags })
  const steps = buildBrandSteps(ROOT, answers)
  await runInitCommand({
    cwd: ROOT,
    flags,
    steps,
    confirmMessage: 'Apply these brand/identity changes?',
  })
}

main().catch((error) => {
  console.error(`init:brand failed: ${error.message}`)
  process.exitCode = 1
})
