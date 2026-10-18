import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { removeMember } from '../../api/member-removal-client'
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
