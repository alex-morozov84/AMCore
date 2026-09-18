#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { buildFallback } from './output.mjs'
import { validateDecision } from './output-schema.mjs'

function args() {
  return parseArgs({
    options: {
      decision: { type: 'string' },
      artifact: { type: 'string' },
      summary: { type: 'string' },
      'run-id': { type: 'string' },
      'run-attempt': { type: 'string' },
      outcome: { type: 'string' },
    },
    strict: true,
  }).values
}

function load(pathname) {
  try {
    return validateDecision(JSON.parse(readFileSync(pathname, 'utf8')))
  } catch (error) {
    return buildFallback({ reason: 'output_invalid', detail: error.message })
  }
}

function sanitize(value) {
  return [...String(value)]
    .map((character) => {
      const code = character.codePointAt(0)
      return code <= 31 || code === 127 ? ' ' : character
    })
    .join('')
    .replace(/[|`<>]/gu, '_')
    .slice(0, 240)
}

function observation(decision, values) {
  const outcome = values.outcome || 'unknown'
  const degradedCodes = new Set([
    'trusted_selector_missing',
    'selector_error',
    'output_invalid',
    'git_error',
    'parser_error',
    'internal_error',
    'declaration_invalid',
    'declaration_stale',
    'declaration_conflict',
  ])
  return {
    runId: values['run-id'] ?? 'unknown',
    runAttempt: values['run-attempt'] ?? 'unknown',
    wouldRun: decision.lanes.generatedFull.required,
    actuallyRan: outcome !== 'skipped',
    generatedStepOutcome: outcome,
    selectorTrustSource: decision.provenance.trustSource,
    selectorDegraded: decision.reasons.some((reason) => degradedCodes.has(reason.code)),
  }
}

function reasonRows(decision) {
  const rows = decision.reasons.slice(0, 50).map((reason) => {
    const paths = reason.paths.length ? reason.paths.join(', ') : '—'
    return `| ${sanitize(reason.code)} | ${sanitize(reason.inputId ?? '—')} | ${sanitize(paths)} |`
  })
  if (decision.reasons.length > rows.length) {
    rows.push(`| … | … | ${decision.reasons.length - rows.length} more in artifact |`)
  }
  return rows.join('\n') || '| none | — | — |'
}

function summary(decision) {
  const observed = decision.observation
  return [
    '## Scaffold selector shadow',
    '',
    '| Would run full | Actually ran | Full-step outcome | Trusted source | Degraded |',
    '| --- | --- | --- | --- | --- |',
    `| ${observed.wouldRun} | ${observed.actuallyRan} | ${sanitize(observed.generatedStepOutcome)} | ${sanitize(observed.selectorTrustSource)} | ${observed.selectorDegraded} |`,
    '',
    '| Reason | Input | Paths |',
    '| --- | --- | --- |',
    reasonRows(decision),
    '',
  ].join('\n')
}

const values = args()
for (const required of ['decision', 'artifact', 'summary']) {
  if (!values[required]) throw new Error(`--${required} is required`)
}
const decision = load(values.decision)
const artifact = validateDecision({ ...decision, observation: observation(decision, values) }, true)
writeFileSync(values.artifact, `${JSON.stringify(artifact, null, 2)}\n`)
writeFileSync(values.summary, `${summary(artifact)}\n`, { flag: 'a' })
