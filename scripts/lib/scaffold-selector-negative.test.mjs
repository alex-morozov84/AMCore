import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  readDeclaration,
  validateDeclaration,
  validateDeclarationTree,
} from '../scaffold-selector/declaration.mjs'
import { validateDecision } from '../scaffold-selector/output-schema.mjs'

function minimal() {
  return {
    schemaVersion: '1.0.0',
    contract: {},
    inputs: [
      {
        id: 'affected',
        graph: 'planning',
        matcher: { kind: 'path', patterns: ['known.md'] },
        statuses: ['A', 'M', 'D', 'R'],
        lane: 'generated-full',
        rationale: 'known',
      },
    ],
    safeInputs: [],
    memberships: [],
    markerPolicies: [],
  }
}

test('malformed, contradictory, and stale declarations fail closed', () => {
  assert.throws(() => validateDeclaration({ ...minimal(), schemaVersion: '2' }), /unsupported/u)
  const conflict = minimal()
  conflict.markerPolicies = [{ id: 'markers', markers: ['KNOWN'] }]
  conflict.safeInputs = [
    {
      id: 'safe',
      matcher: { kind: 'path', patterns: ['known.md'] },
      statuses: ['M'],
      markerPolicy: 'markers',
      rationale: 'safe',
    },
  ]
  assert.throws(() => validateDeclaration(conflict), /safe and affected/u)
  assert.throws(
    () => validateDeclarationTree(validateDeclaration(minimal()), []),
    (error) => error.code === 'declaration_stale'
  )
})

test('Git and merge-base failures still emit a valid full decision', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'amcore-selector-negative-'))
  const output = path.join(root, 'decision.json')
  try {
    execFileSync('node', [
      'scripts/scaffold-selector/cli.mjs',
      '--repo',
      process.cwd(),
      '--base',
      'invalid',
      '--head',
      'invalid',
      '--declaration',
      'scripts/scaffold-selector/declaration.v1.json',
      '--selector-version',
      'probe',
      '--output',
      output,
    ])
    const decision = validateDecision(JSON.parse(readFileSync(output, 'utf8')))
    assert.equal(decision.lanes.generatedFull.required, true)
    assert.equal(decision.reasons[0].code, 'git_error')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the committed declaration remains valid and versioned', () => {
  const declaration = readDeclaration('scripts/scaffold-selector/declaration.v1.json')
  assert.equal(declaration.schemaVersion, '1.0.0')
  assert.ok(declaration.inputs.some((input) => input.id === 'planning.direct-inputs'))
})
