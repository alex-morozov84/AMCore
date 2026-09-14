#!/usr/bin/env node
// `pnpm measure:scaffold` — opt-in scaffolding baseline measurement and
// transform inventory (BACKLOG item 14, PR1). Never runs as part of
// `test:scripts` or any CI job by default: this is a manual/maintainer tool
// for gathering the evidence item 14's redesign needs, not a new required
// gate. Each run performs real disposable-copy installs/builds for every
// registered scenario (scripts/measure/scenario-registry.mjs) — genuinely
// slow, several minutes; use --only to iterate on one scenario locally.
//
// Usage:
//   pnpm measure:scaffold                         # full baseline, all scenarios
//   pnpm measure:scaffold --only=single-locale-en  # one scenario (repeatable flag)
//   pnpm measure:scaffold --out=tmp/my-report.json # custom report path
//
// Writes a versioned JSON report (report-schema.mjs) plus prints a human
// summary. Intentionally does not add or modify any CI workflow — wiring
// this into CI (a scheduled baseline job, artifact upload) is deferred to a
// later slice once item 14's design actually needs it, not added
// speculatively here.
import { parseArgs } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildBaselineReport, renderHumanSummary } from './baseline-report.mjs'
import { SCENARIOS } from './scenario-registry.mjs'

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      only: { type: 'string', multiple: true, default: [] },
      out: { type: 'string', default: 'tmp/scaffolding-baseline/report.json' },
    },
  })
  return values
}

/** Returns `null` if every `--only` name is known, otherwise an error message to print. */
function validateOnlyNames(only) {
  const known = new Set(SCENARIOS.map((s) => s.name))
  const unknown = only.filter((name) => !known.has(name))
  if (unknown.length === 0) return null
  return `unknown scenario name(s): ${unknown.join(', ')}\nknown scenarios: ${[...known].join(', ')}`
}

function writeReport(report, out) {
  const outPath = path.resolve(out)
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
  return outPath
}

async function main() {
  const { only, out } = parseCliArgs(process.argv.slice(2))
  const onlyError = only.length > 0 ? validateOnlyNames(only) : null
  if (onlyError) {
    console.error(onlyError)
    process.exitCode = 1
    return
  }

  const scenarioFilter = only.length > 0 ? (scenario) => only.includes(scenario.name) : undefined
  const onProgress = (name) => console.log(`[measure:scaffold] running scenario "${name}"...`)
  const report = await buildBaselineReport({ scenarioFilter, onProgress })
  const outPath = writeReport(report, out)

  console.log(`\n${renderHumanSummary(report)}`)
  console.log(`\nFull report written to ${path.relative(process.cwd(), outPath)}`)
  if (!report.comparability.comparable) {
    console.log(`\nNOTE: this run is NOT comparable (${report.comparability.reason}) — do not use it as a published baseline.`)
  }
  if (report.scenarios.some((s) => !s.success)) process.exitCode = 1
}

main().catch((error) => {
  console.error(`measure:scaffold failed: ${error.message}`)
  process.exitCode = 1
})
