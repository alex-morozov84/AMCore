import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { createOrganizationContextLease } from './context-lease'

describe('organization context publication lifetime', () => {
  it('cannot publish an old completed write into another identity cache, callback or toast', () => {
    const lease = createOrganizationContextLease()
    const queries = new QueryClient()
    const old = lease.begin('session-x', 'org-a')
    const callback = vi.fn()
    const toast = vi.fn()
    const current = lease.begin('session-y', 'org-a')
    expect(old.signal.aborted).toBe(true)
    expect(
      lease.publish(old, () => {
        queries.setQueryData(['organization-context', current.binding, current.target], {
          name: 'Old completed write',
        })
        callback()
        toast()
      })
    ).toBe(false)
    expect(
      queries.getQueryData(['organization-context', current.binding, current.target])
    ).toBeUndefined()
    expect(callback).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(lease.publish(current, callback)).toBe(true)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('retires callbacks on same-identity target change and consumer disposal', () => {
    const lease = createOrganizationContextLease()
    const first = lease.begin('session-x', 'org-a')
    const next = lease.begin('session-x', 'org-b')
    const callback = vi.fn()
    expect(lease.publish(first, callback)).toBe(false)
    lease.retire()
    expect(lease.publish(next, callback)).toBe(false)
    expect(next.signal.aborted).toBe(true)
    expect(callback).not.toHaveBeenCalled()
  })
})
