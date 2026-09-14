// Validation of individual semantic-write claims and of claims *within* one
// operation — the layer below cross-key conflict detection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { deriveSemanticWrites } from './path-algebra-semantic-writes.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict, stubDefinition } from './path-algebra-test-helpers.mjs'

const invalidClaim = conflict(CONFLICT_CODES.INVALID_SEMANTIC_WRITE)
const fact = { path: 'p', operationKey: 'op-a', params: {}, dimensions: new Set(['d']) }

function derive(deriveSemanticWrites_) {
  const registry = createOperationRegistry()
  registry.define('op-a', stubDefinition({ deriveSemanticWrites: deriveSemanticWrites_ }))
  return () => deriveSemanticWrites(registry, fact)
}

test('a claim that is not an object is rejected', () => {
  assert.throws(
    derive(() => ['eslint:x']),
    invalidClaim
  )
  assert.throws(
    derive(() => [null]),
    invalidClaim
  )
})

test('a claim without a location, or with an empty one, is rejected', () => {
  assert.throws(
    derive(() => [{ value: 1 }]),
    invalidClaim
  )
  assert.throws(
    derive(() => [{ location: '', value: 1 }]),
    invalidClaim
  )
  assert.throws(
    derive(() => [{ location: 42, value: 1 }]),
    invalidClaim
  )
})

test('a claim whose value has no canonical JSON form is rejected', () => {
  assert.throws(
    derive(() => [{ location: 'loc' }]),
    invalidClaim
  )
  assert.throws(
    derive(() => [{ location: 'loc', value: undefined }]),
    invalidClaim
  )
  assert.throws(
    derive(() => [{ location: 'loc', value: () => {} }]),
    invalidClaim
  )
  assert.throws(
    derive(() => [{ location: 'loc', value: Symbol('s') }]),
    invalidClaim
  )
})

test('a claim whose value cannot be serialized (BigInt, cycle) is rejected with the reason', () => {
  assert.throws(
    derive(() => [{ location: 'loc', value: 1n }]),
    invalidClaim
  )
  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(
    derive(() => [{ location: 'loc', value: cyclic }]),
    (error) => invalidClaim(error) && /cannot be canonicalized/.test(error.message)
  )
})

test('the diagnostic names the claim index so a multi-claim definition is debuggable', () => {
  assert.throws(
    derive(() => [{ location: 'ok', value: 1 }, { location: '' }]),
    (error) => invalidClaim(error) && error.message.includes('claim #1')
  )
})

test('null, false, 0 and "" are legitimate canonical values', () => {
  const claims = derive(() => [
    { location: 'a', value: null },
    { location: 'b', value: false },
    { location: 'c', value: 0 },
    { location: 'd', value: '' },
  ])()
  assert.deepEqual(
    claims.map((claim) => claim.canonicalValue),
    ['null', 'false', '0', '""']
  )
})

test('one operation claiming the same location with two different values conflicts', () => {
  assert.throws(
    derive(() => [
      { location: 'loc', value: 1 },
      { location: 'loc', value: 2 },
    ]),
    (error) =>
      conflict(CONFLICT_CODES.SEMANTIC_WRITE_CONFLICT)(error) &&
      /inside one operation/.test(error.message)
  )
})

test('one operation claiming the same location twice with the same value collapses to one claim', () => {
  const claims = derive(() => [
    { location: 'loc', value: { a: 1 } },
    { location: 'loc', value: { a: 1 } },
  ])()
  assert.equal(claims.length, 1)
})

test('a deriveSemanticWrites that throws is a diagnosable invalid-semantic-write, keeping its message', () => {
  assert.throws(
    derive(() => {
      throw new Error('params.locale missing')
    }),
    (error) => invalidClaim(error) && error.message.includes('params.locale missing')
  )
})
