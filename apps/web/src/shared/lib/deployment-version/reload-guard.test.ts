import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('client-only', () => ({}))

import { allowReplacement, reconcileRecovery } from './reload-guard'

describe('deployment replacement guard', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('permits A→B→A→B but bounds rapid replica oscillation', () => {
    expect(allowReplacement('B')).toBe(true)
    reconcileRecovery('B')
    expect(allowReplacement('A')).toBe(true)
    reconcileRecovery('A')
    expect(allowReplacement('B')).toBe(true)
    reconcileRecovery('B')
    expect(allowReplacement('A')).toBe(false)
  })

  it('does not repeat when the document reloads from stale HTML', () => {
    expect(allowReplacement('B')).toBe(true)
    reconcileRecovery('A')
    expect(allowReplacement('B')).toBe(false)
    expect(allowReplacement('C')).toBe(false)
    reconcileRecovery('B')
    expect(allowReplacement('C')).toBe(true)
  })

  it('does not reload if it cannot persist protection across documents', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(allowReplacement('B')).toBe(false)
  })
})
