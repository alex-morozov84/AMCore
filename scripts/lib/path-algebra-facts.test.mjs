import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validateFacts, InvalidPathFactError } from './path-algebra-facts.mjs'

describe('validateFacts', () => {
  test('accepts the three M1 fact kinds', () => {
    const facts = [
      { kind: 'delete', path: 'a', dimension: 'x' },
      { kind: 'content', path: 'b', dimension: 'y' },
      { kind: 'move', from: 'c', to: 'd', dimension: 'z' },
    ]
    assert.deepEqual(validateFacts(facts), facts)
  })

  test('rejects an unknown kind instead of silently dropping it', () => {
    assert.throws(
      () => validateFacts([{ kind: 'mystery', path: 'a', dimension: 'x' }]),
      (error) => error instanceof InvalidPathFactError && /unsupported kind/.test(error.message)
    )
  })

  test('rejects missing provenance or target fields', () => {
    assert.throws(() => validateFacts([{ kind: 'delete', path: 'a' }]), InvalidPathFactError)
    assert.throws(() => validateFacts([{ kind: 'move', from: 'a', dimension: 'x' }]), InvalidPathFactError)
  })

  test('rejects a non-array collection and non-object fact', () => {
    assert.throws(() => validateFacts(null), InvalidPathFactError)
    assert.throws(() => validateFacts([null]), InvalidPathFactError)
  })
})
