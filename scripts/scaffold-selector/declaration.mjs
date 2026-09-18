import { readFileSync } from 'node:fs'
import path from 'node:path'

import { fail } from './errors.mjs'
import { patternMatches, validatePath } from './paths.mjs'

const GRAPHS = new Set(['planning', 'generated-verification', 'control'])
const KINDS = new Set(['path', 'root', 'glob'])
const STATUSES = new Set(['A', 'M', 'D', 'R'])
const TOP_KEYS = [
  'contract',
  'inputs',
  'markerPolicies',
  'memberships',
  'safeInputs',
  'schemaVersion',
]

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    fail('declaration_invalid', `${label} fields must be exactly: ${expected.join(', ')}`)
  }
}

function strings(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((item) => !item)) {
    fail('declaration_invalid', `${label} must be a non-empty string array`)
  }
  if (new Set(values).size !== values.length) fail('declaration_invalid', `${label} has duplicates`)
}

function matcher(value, label) {
  exactKeys(value, ['kind', 'patterns'], `${label}.matcher`)
  if (!KINDS.has(value.kind)) fail('declaration_invalid', `${label} has unknown matcher kind`)
  strings(value.patterns, `${label}.matcher.patterns`)
  value.patterns.forEach((item) => validatePath(item, `${label}.matcher.pattern`))
}

function statuses(values, label) {
  strings(values, `${label}.statuses`)
  if (values.some((item) => !STATUSES.has(item))) {
    fail('declaration_invalid', `${label} has an unsupported diff status`)
  }
}

function validateInput(entry, label) {
  exactKeys(entry, ['graph', 'id', 'lane', 'matcher', 'rationale', 'statuses'], label)
  if (!GRAPHS.has(entry.graph)) fail('declaration_invalid', `${label} has unknown graph`)
  if (entry.lane !== 'generated-full') fail('declaration_invalid', `${label} has unknown lane`)
  if (!entry.id || !entry.rationale) fail('declaration_invalid', `${label} needs id/rationale`)
  matcher(entry.matcher, label)
  statuses(entry.statuses, label)
}

function validateSafe(entry, markerIds, label) {
  exactKeys(entry, ['id', 'markerPolicy', 'matcher', 'rationale', 'statuses'], label)
  if (!entry.id || !entry.rationale) fail('declaration_invalid', `${label} needs id/rationale`)
  if (!markerIds.has(entry.markerPolicy)) fail('declaration_invalid', `${label} marker is missing`)
  matcher(entry.matcher, label)
  statuses(entry.statuses, label)
  if (entry.statuses.some((item) => item !== 'M')) {
    fail('declaration_invalid', `${label} may admit modifications only`)
  }
}

function validateMarkers(policies) {
  for (const [index, policy] of policies.entries()) {
    exactKeys(policy, ['id', 'markers'], `markerPolicies[${index}]`)
    if (!policy.id) fail('declaration_invalid', `markerPolicies[${index}] needs an id`)
    strings(policy.markers, `markerPolicies[${index}].markers`)
  }
}

function validateMembership(entry, index) {
  const label = `memberships[${index}]`
  exactKeys(entry, ['cardinality', 'glob', 'graph', 'id'], label)
  if (!entry.id || !GRAPHS.has(entry.graph)) fail('declaration_invalid', `${label} is invalid`)
  if (!['one', 'one-or-more'].includes(entry.cardinality)) {
    fail('declaration_invalid', `${label} has invalid cardinality`)
  }
  validatePath(entry.glob, `${label}.glob`)
}

function validateIds(declaration) {
  const entries = [...declaration.inputs, ...declaration.safeInputs, ...declaration.memberships]
  const ids = entries.map((entry) => entry.id)
  if (new Set(ids).size !== ids.length) fail('declaration_conflict', 'entry ids must be unique')
  const exact = new Map()
  for (const entry of [...declaration.inputs, ...declaration.safeInputs]) {
    for (const pattern of entry.matcher.patterns) {
      const key = `${entry.matcher.kind}:${pattern}`
      const prior = exact.get(key)
      if (prior && prior !== 'graph' in entry) {
        fail('declaration_conflict', `safe and affected entries both declare ${key}`)
      }
      exact.set(key, 'graph' in entry)
    }
  }
}

export function validateDeclaration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('declaration_invalid', 'declaration must be an object')
  }
  exactKeys(value, TOP_KEYS, 'declaration')
  if (value.schemaVersion !== '1.0.0') fail('declaration_invalid', 'unsupported schemaVersion')
  for (const field of ['inputs', 'safeInputs', 'memberships', 'markerPolicies']) {
    if (!Array.isArray(value[field])) fail('declaration_invalid', `${field} must be an array`)
  }
  if (!value.contract || typeof value.contract !== 'object') {
    fail('declaration_invalid', 'contract projection must be an object')
  }
  validateMarkers(value.markerPolicies)
  value.inputs.forEach((entry, index) => validateInput(entry, `inputs[${index}]`))
  const markerIds = new Set(value.markerPolicies.map((item) => item.id))
  value.safeInputs.forEach((entry, index) => validateSafe(entry, markerIds, `safeInputs[${index}]`))
  value.memberships.forEach(validateMembership)
  validateIds(value)
  return value
}

export function readDeclaration(pathname) {
  const root = JSON.parse(readFileSync(pathname, 'utf8'))
  exactKeys(root, ['fragments', 'schemaVersion'], 'declaration root')
  if (root.schemaVersion !== '1.0.0') fail('declaration_invalid', 'unsupported schemaVersion')
  strings(root.fragments, 'declaration root.fragments')
  const directory = path.dirname(pathname)
  const parts = root.fragments.map((name) => {
    if (path.basename(name) !== name || !name.endsWith('.json')) {
      fail('declaration_invalid', `invalid declaration fragment ${name}`)
    }
    return JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
  })
  return validateDeclaration(Object.assign({ schemaVersion: root.schemaVersion }, ...parts))
}

export function validateDeclarationTree(declaration, files) {
  const entries = [...declaration.inputs, ...declaration.safeInputs]
  for (const entry of entries) {
    for (const pattern of entry.matcher.patterns) {
      if (!files.some((file) => patternMatches(entry.matcher.kind, pattern, file))) {
        fail('declaration_stale', `${entry.id} pattern ${pattern} matches no base-tree path`)
      }
    }
  }
}
