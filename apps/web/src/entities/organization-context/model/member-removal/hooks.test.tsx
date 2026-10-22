import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { removalFailure, removeMember } from '../../api/member-removal-client'
import { membersClient } from '../../api/members-client'
import { createOrganizationAccessController } from '../access-controller'

import { useMemberRemoval } from './hooks'
vi.mock('../../api/member-removal-client', async (original) => ({
  ...(await original<object>()),
  removeMember: vi.fn(),
}))
vi.mock('../../api/members-client', () => ({ membersClient: { roles: vi.fn() } }))
const target = { userId: 'user', memberId: 'member', email: 'user@example.test' }
function setup() {
  const controller = createOrganizationAccessController('binding', 'org')
  controller.setAuthority(true)
  controller.setRefresh(async () => 'ready')
  return { controller, ...renderHook(() => useMemberRemoval(controller, target)) }
}
beforeEach(() => vi.resetAllMocks())
describe('member removal state', () => {
  it.each([true, false])(
    'publishes only confirmed acknowledgement before refresh: %s',
    async (ack) => {
      const controller = createOrganizationAccessController('binding', 'org')
      const events: string[] = []
      controller.setAuthority(true)
      controller.setRefresh(async () => {
        events.push('refresh')
        return 'denied'
      })
      if (ack) vi.mocked(removeMember).mockResolvedValue({ removed: true })
      else vi.mocked(removeMember).mockRejectedValue(new Error('lost acknowledgement'))
      const { result } = renderHook(() =>
        useMemberRemoval(controller, target, () => {
          events.push('acknowledged')
        })
      )
      await act(async () => {
        await result.current.remove()
      })
      expect(events).toEqual(ack ? ['acknowledged', 'refresh'] : ['refresh'])
      expect(result.current.outcome?.status).toBe(ack ? 'committed' : 'unknown')
    }
  )
  it.each(['denied', 'error'] as const)(
    'preserves acknowledged self removal with %s follow-up',
    async (status) => {
      const { controller, result } = setup()
      controller.setRefresh(async () => status)
      vi.mocked(removeMember).mockResolvedValue({ removed: true })
      await act(async () => {
        await result.current.remove()
      })
      expect(result.current.outcome).toEqual({
        status: 'committed',
        result: { removed: true },
        followup: status,
      })
    }
  )
  it.each([
    [400, 'BUSINESS_RULE_VIOLATION'],
    [404, 'RESOURCE_NOT_FOUND'],
    [409, 'MEMBER_ROLES_CONFLICT'],
  ])('classifies actual %i/%s as rejected', async (status, errorCode) => {
    const { result } = setup()
    vi.mocked(removeMember).mockRejectedValue(
      new ApiRequestError(Number(status), { errorCode } as never)
    )
    await act(async () => {
      await result.current.remove()
    })
    expect(result.current.outcome?.status).toBe('rejected')
  })
  it('never replays an unknown write during inspection; same membership permits fresh confirmation', async () => {
    const { result } = setup()
    vi.mocked(removeMember).mockRejectedValue(new Error('lost ack'))
    vi.mocked(membersClient.roles).mockResolvedValue({ member: { memberId: 'member' } } as never)
    await act(async () => {
      await result.current.remove()
    })
    expect(result.current.canRemove).toBe(false)
    await act(async () => {
      await result.current.inspect()
    })
    expect(removeMember).toHaveBeenCalledTimes(1)
    expect(result.current.outcome?.status).toBe('unknown')
    expect(result.current.inspection?.status).toBe('same')
    expect(result.current.canRemove).toBe(true)
  })
  it('a rejoined membership cannot be removed by the old target', async () => {
    const { result } = setup()
    vi.mocked(removeMember).mockRejectedValue(new Error('lost ack'))
    vi.mocked(membersClient.roles).mockResolvedValue({
      member: { memberId: 'new-member' },
    } as never)
    await act(async () => {
      await result.current.remove()
    })
    await act(async () => {
      await result.current.inspect()
    })
    expect(result.current.inspection).toEqual({ status: 'different', memberId: 'new-member' })
    expect(result.current.canRemove).toBe(false)
  })
  it.each(['user', 'member', 'binding', 'org'] as const)(
    'retires old callbacks after %s changes',
    async (dimension) => {
      let finish!: (value: { removed: true }) => void
      vi.mocked(removeMember).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      const first = createOrganizationAccessController('binding', 'org')
      first.setAuthority(true)
      first.setRefresh(async () => 'ready')
      const initial = { controller: first, target }
      const { result, rerender } = renderHook(
        (props) => useMemberRemoval(props.controller, props.target),
        { initialProps: initial }
      )
      const captured = result.current.remove
      let pending!: ReturnType<typeof captured>
      act(() => {
        pending = captured()
      })
      const next = { ...initial, target: { ...target } }
      if (dimension === 'user') next.target.userId = 'other'
      if (dimension === 'member') next.target.memberId = 'rejoined'
      if (dimension === 'binding' || dimension === 'org') {
        next.controller = createOrganizationAccessController(
          dimension === 'binding' ? 'other' : 'binding',
          dimension === 'org' ? 'other' : 'org'
        )
        next.controller.setAuthority(true)
        next.controller.setRefresh(async () => 'ready')
      }
      rerender(next)
      await act(async () => {
        expect(await captured()).toBeUndefined()
      })
      await act(async () => {
        finish({ removed: true })
        expect(await pending).toEqual({ status: 'retired' })
      })
      expect(result.current.outcome).toBeUndefined()
    }
  )
  it.each(['resolve', 'reject'] as const)(
    'retires late %s after unmount and suppresses duplicate writes',
    async (mode) => {
      let resolve!: (value: { removed: true }) => void
      let reject!: (error: Error) => void
      vi.mocked(removeMember).mockReturnValue(
        new Promise((yes, no) => {
          resolve = yes
          reject = no
        })
      )
      const { result, unmount } = setup()
      let pending!: ReturnType<typeof result.current.remove>
      act(() => {
        pending = result.current.remove()
        void result.current.remove()
      })
      expect(removeMember).toHaveBeenCalledTimes(1)
      unmount()
      await act(async () => {
        if (mode === 'resolve') resolve({ removed: true })
        else reject(new Error('late'))
        expect(await pending).toEqual({ status: 'retired' })
      })
    }
  )
})

describe('server retry deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())
  it.each([
    [503, 'MEMBER_API_KEYS_WRITE_UNAVAILABLE'],
    [503, 'FORBIDDEN'],
    [404, 'BUSINESS_RULE_VIOLATION'],
  ])(
    'keeps %i/%s unknown and blocks requests until Retry-After expires',
    async (status, errorCode) => {
      const { controller, result } = setup()
      const refresh = vi.fn(async () => 'ready' as const)
      controller.setRefresh(refresh)
      vi.mocked(removeMember).mockRejectedValue(
        removalFailure(Number(status), { errorCode }, new Headers({ 'Retry-After': '60' }))
      )
      await act(async () => {
        await result.current.remove()
      })
      const deadline = Date.now() + 60000
      expect(result.current.outcome).toMatchObject({ status: 'unknown', retryAt: deadline })
      expect(result.current.retryAt).toBe(deadline)
      await act(async () => {
        await result.current.inspect()
        await result.current.remove()
      })
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(membersClient.roles).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(59999)
        await result.current.inspect()
      })
      expect(refresh).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(result.current.retryAt).toBeUndefined()
      expect(removeMember).toHaveBeenCalledTimes(1)
      vi.mocked(membersClient.roles).mockResolvedValue({ member: { memberId: 'member' } } as never)
      await act(async () => {
        await result.current.inspect()
      })
      expect(refresh).toHaveBeenCalledTimes(2)
      expect(membersClient.roles).toHaveBeenCalledTimes(1)
      expect(result.current.canRemove).toBe(true)
    }
  )
  it.each([429, 503])(
    'honors a %i inspection cooldown without automatic reads or writes',
    async (status) => {
      const { controller, result } = setup()
      const refresh = vi.fn(async () => 'ready' as const)
      controller.setRefresh(refresh)
      vi.mocked(removeMember).mockRejectedValue(new Error('lost acknowledgment'))
      vi.mocked(membersClient.roles).mockRejectedValueOnce(
        new ApiRequestError(status, { errorCode: 'RATE_LIMIT_EXCEEDED' } as never, 60)
      )
      await act(async () => {
        await result.current.remove()
      })
      await act(async () => {
        await result.current.inspect()
        await result.current.inspect()
      })
      expect(result.current.retryAt).toBe(Date.now() + 60000)
      expect(result.current.canRemove).toBe(false)
      expect(membersClient.roles).toHaveBeenCalledTimes(1)
      expect(refresh).toHaveBeenCalledTimes(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(59999)
        await result.current.inspect()
        await result.current.remove()
      })
      expect(membersClient.roles).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(membersClient.roles).toHaveBeenCalledTimes(1)
      vi.mocked(membersClient.roles).mockResolvedValue({ member: { memberId: 'member' } } as never)
      await act(async () => {
        await result.current.inspect()
      })
      expect(result.current.canRemove).toBe(true)
      expect(removeMember).toHaveBeenCalledTimes(1)
    }
  )
})
