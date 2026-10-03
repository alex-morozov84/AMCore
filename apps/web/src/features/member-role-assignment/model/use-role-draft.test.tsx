import type { PropsWithChildren } from 'react'
import { useForm } from 'react-hook-form'
import type { MemberRolesResponse } from '@amcore/shared'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { useMemberRoleAssignments } from '@/entities/organization-context'
import type { OrganizationAccessController } from '@/entities/organization-context'

import { useRoleDraft } from './use-role-draft'

vi.mock('@/shared/hooks/use-localized-form', () => ({
  useLocalizedForm: (_schema: unknown, options: Parameters<typeof useForm>[0]) => useForm(options),
}))
const initial: MemberRolesResponse = {
  member: { memberId: 'member', user: { id: 'user', email: 'u@example.test', name: 'Name' } },
  aclVersion: 1,
  assignedRoleCount: 1,
  assignedRoles: [{ id: 'one', name: 'One', description: null, isSystem: true }],
  editMode: 'editable',
  choices: { data: [], total: 0, page: 1, limit: 20 },
}
const wrapper = ({ children }: PropsWithChildren) => <>{children}</>
function fixture() {
  const controller = {
    capture: () => 0,
    current: () => true,
    refresh: vi.fn().mockResolvedValue('ready'),
  } as unknown as OrganizationAccessController
  const reads = {
    data: initial,
    ready: true,
    pending: false,
    busy: false,
    identity: '',
    refresh: vi.fn().mockResolvedValue(initial),
    save: vi.fn(),
    error: undefined,
  } as ReturnType<typeof useMemberRoleAssignments>
  return { controller, reads }
}
describe('role draft recovery and settlement', () => {
  it('new authority revision does not erase unsaved selected roles; review explicitly adopts fresh state', async () => {
    const { controller, reads } = fixture()
    const { result, rerender } = renderHook(
      ({ data }) => useRoleDraft(initial, { ...reads, data }, controller),
      { wrapper, initialProps: { data: initial } }
    )
    act(() => result.current.form.setValue('roleIds', ['one', 'two']))
    const fresh = { ...initial, aclVersion: 2 }
    rerender({ data: fresh })
    expect(result.current.selected).toEqual(['one', 'two'])
    expect(result.current.needsReview).toBe(true)
    vi.mocked(reads.refresh).mockResolvedValue(fresh)
    await act(async () => result.current.review())
    expect(result.current.selected).toEqual(['one'])
    expect(result.current.snapshot.aclVersion).toBe(2)
  })
  it('confirmed Save with ready follow-up completes without extra refresh/reset controls', async () => {
    const { controller, reads } = fixture()
    const complete = vi.fn()
    vi.mocked(reads.save).mockResolvedValue({
      status: 'committed',
      followup: 'ready',
      result: {} as never,
    })
    const { result } = renderHook(() => useRoleDraft(initial, reads, controller, complete), {
      wrapper,
    })
    await act(async () =>
      result.current.submit({
        expectedMemberId: 'member',
        expectedAclVersion: 1,
        roleIds: ['one', 'two'],
      })
    )
    expect(complete).toHaveBeenCalledOnce()
    expect(reads.refresh).not.toHaveBeenCalled()
  })
  it('unknown write is not replayed; failed review preserves selection and exposes exit', async () => {
    const { controller, reads } = fixture()
    const complete = vi.fn()
    vi.mocked(reads.save).mockResolvedValue({ status: 'unknown', error: new Error('ack lost') })
    vi.mocked(reads.refresh).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useRoleDraft(initial, reads, controller, complete), {
      wrapper,
    })
    act(() => result.current.form.setValue('roleIds', ['one', 'two']))
    await act(async () =>
      result.current.submit({
        expectedMemberId: 'member',
        expectedAclVersion: 1,
        roleIds: ['one', 'two'],
      })
    )
    expect(result.current.notice).toBe('unknown')
    expect(complete).not.toHaveBeenCalled()
    await act(async () => result.current.review())
    expect(result.current.selected).toEqual(['one', 'two'])
    expect(result.current.reviewing).toBe(false)
    expect(result.current.notice).toBe('reviewFailed')
    expect(reads.save).toHaveBeenCalledOnce()
  })
  it('review deadline releases exit without replaying a write or losing selection', async () => {
    vi.useFakeTimers()
    try {
      const { controller, reads } = fixture()
      vi.mocked(controller.refresh).mockImplementationOnce(() => new Promise(() => undefined))
      const { result } = renderHook(() => useRoleDraft(initial, reads, controller), { wrapper })
      act(() => result.current.form.setValue('roleIds', ['one', 'two']))
      let work!: Promise<void>
      act(() => {
        work = result.current.review()
      })
      expect(result.current.reviewing).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
        await work
      })
      expect(result.current.reviewing).toBe(false)
      expect(result.current.selected).toEqual(['one', 'two'])
      expect(reads.save).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
