import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

describe('PathAlgebraConflictError', () => {
  test('sorts and dedupes paths and dimensions regardless of input order', () => {
    const error = new PathAlgebraConflictError(CONFLICT_CODES.UNRESOLVED_OVERLAP, {
      paths: ['z', 'a', 'm'],
      dimensions: ['zeta', 'alpha', 'alpha'],
      detail: 'example',
    })
    assert.deepEqual(error.paths, ['a', 'm', 'z'])
    assert.deepEqual(error.dimensions, ['alpha', 'zeta'])
  })

  test('exposes the conflict code as a stable field, not only in the message', () => {
    const error = new PathAlgebraConflictError(CONFLICT_CODES.MOVE_CYCLE, {
      paths: ['a'],
      dimensions: ['x'],
      detail: 'example',
    })
    assert.equal(error.code, 'move-cycle')
  })

  test('the message names the code, detail, paths, and dimensions', () => {
    const error = new PathAlgebraConflictError(CONFLICT_CODES.DELETE_CONTENT_CONFLICT, {
      paths: ['a/b.ts'],
      dimensions: ['storybook'],
      detail: 'path "a/b.ts" is both deleted and content-edited',
    })
    assert.match(error.message, /delete-content-conflict/)
    assert.match(error.message, /a\/b\.ts/)
    assert.match(error.message, /storybook/)
  })

  test('is a real Error instance usable with assert.throws', () => {
    assert.throws(() => {
      throw new PathAlgebraConflictError(CONFLICT_CODES.MOVE_CYCLE, { paths: [], dimensions: [], detail: 'x' })
    }, PathAlgebraConflictError)
  })
})
