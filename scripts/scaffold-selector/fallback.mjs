#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { buildFallback } from './output.mjs'
import { validateDecision } from './output-schema.mjs'

const { values } = parseArgs({
  options: {
    reason: { type: 'string' },
    detail: { type: 'string' },
    output: { type: 'string' },
    event: { type: 'string' },
    'base-ref': { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string' },
  },
  strict: true,
})

if (!values.reason || !values.output) throw new Error('--reason and --output are required')
const decision = buildFallback({
  reason: values.reason,
  detail: values.detail ?? values.reason,
  provenance: {
    event: values.event,
    baseRef: values['base-ref'],
    baseSha: values.base ?? null,
    headSha: values.head ?? null,
  },
})
validateDecision(decision)
mkdirSync(path.dirname(values.output), { recursive: true })
writeFileSync(values.output, `${JSON.stringify(decision, null, 2)}\n`)
