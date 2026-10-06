import { StrictMode } from 'react'
import { useForm } from 'react-hook-form'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  InvitationManagerOperations,
  OrganizationAccessController,
} from '@/entities/organization-context'

import { useInvitationDraft } from './use-invitation-draft'

const fixture = vi.hoisted(() => ({
  roles: {
    pending: false,
    ready: true,
    error: undefined,
    data: {
      data: [{ id: 'member', name: 'MEMBER' }],
      defaultRole: { id: 'member', name: 'MEMBER' },
    },
  },
}))
vi.mock('@/entities/organization-context', () => ({
  useInvitationRoleChoices: () => fixture.roles,
}))
vi.mock('@/shared/hooks/use-localized-form', () => ({
  useLocalizedForm: (_schema: unknown, options: Parameters<typeof useForm>[0]) => useForm(options),
}))
const access = {} as OrganizationAccessController
const operations = {} as InvitationManagerOperations

describe('invitation draft default role', () => {
  it('initializes a cached default under StrictMode and keeps an explicitly cleared selection', () => {
    fixture.roles.pending = true
    const { result, rerender } = renderHook(
      () => useInvitationDraft(access, operations, 'create'),
      { wrapper: StrictMode }
    )
    fixture.roles.pending = false
    rerender()
    expect(result.current.selected).toEqual(['member'])
    act(() => result.current.form.setValue('roleIds', [], { shouldDirty: true }))
    rerender()
    expect(result.current.selected).toEqual([])
  })
})
