import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createInvitationOperationId } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { provisioningClient as api } from '@/shared/api/console/provisioning-client'

import { type PendingProvisioning, writeProvisioningJournal } from './journal'
import { useProvisioning } from './use-provisioning'

// The build now serves Russian only; the saved commands were written while English was served too.
vi.mock('@amcore/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SUPPORTED_LOCALES: ['ru'] as const,
  DEFAULT_LOCALE: 'ru' as const,
  coerceSupportedLocale: () => 'ru' as const,
}))
vi.mock('@/shared/api/console/provisioning-client', () => ({
  provisioningClient: {
    session: vi.fn(),
    policy: vi.fn(),
    progress: vi.fn(),
    lookup: vi.fn(),
    create: vi.fn(),
    recover: vi.fn(),
  },
}))
vi.mock('@/shared/api/console-api', () => ({ consoleApi: { stepUp: vi.fn() } }))

const admission = {
  binding: 'a'.repeat(64),
  actor: { id: 'operator', email: 'operator@example.test' },
}
const draft = {
  name: 'North shop',
  slug: 'north-shop',
  firstAdminEmail: 'anna@example.test',
  inviteLocale: 'ru' as const,
}
const operationId = createInvitationOperationId()
const frozenCreate: PendingProvisioning = {
  kind: 'create',
  input: { ...draft, operationId, inviteLocale: 'en' },
}
const frozenReplace: PendingProvisioning = {
  kind: 'replace-recipient',
  input: {
    operationId: createInvitationOperationId(),
    expectedRevision: 2,
    firstAdminEmail: 'new@example.test',
    inviteLocale: 'en',
  },
}

function save(pending: PendingProvisioning, organizationId?: string) {
  writeProvisioningJournal(
    {
      version: 1,
      actorId: admission.actor.id,
      binding: admission.binding,
      at: Date.now(),
      open: true,
      step: 3,
      draft,
      organizationId,
      pending,
    },
    organizationId ? organizationId : 'create'
  )
}
function mount(scope?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: PropsWithChildren) => (
    <NextIntlClientProvider locale="ru" messages={{ errors: {} }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  return renderHook(() => useProvisioning(admission, scope), { wrapper })
}
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(api.session).mockResolvedValue(admission)
  vi.mocked(api.policy).mockResolvedValue({ role: 'ADMIN', mailMode: 'mock', createAllowed: true })
})

describe('a saved command written under other served languages', () => {
  it('is never sent changed: a committed creation is recovered by its original operation ID', async () => {
    save(frozenCreate)
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    expect(view.result.current.record?.pending).toEqual(frozenCreate)
    vi.mocked(api.lookup).mockResolvedValue({
      state: 'committed',
      receipt: {
        operationId,
        organizationId: 'saved-organization',
        createdAt: new Date().toISOString(),
      },
    })
    await act(() => view.result.current.submit())
    expect(api.create).not.toHaveBeenCalled()
    expect(api.lookup).toHaveBeenCalledWith(admission.binding, operationId, expect.anything())
    expect(view.result.current.record?.organizationId).toBe('saved-organization')
    expect(view.result.current.record?.pending).toBeUndefined()
    expect(view.result.current.notice).toBeUndefined()
  })
  it('is released with a notice when nothing was recorded, keeping the draft', async () => {
    save(frozenCreate)
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    vi.mocked(api.lookup).mockResolvedValue({ state: 'unrecorded', sameIdAdmissible: true })
    await act(() => view.result.current.submit())
    expect(api.create).not.toHaveBeenCalled()
    expect(view.result.current.record?.pending).toBeUndefined()
    expect(view.result.current.record?.draft).toEqual(draft)
    expect(view.result.current.notice).toBe('requestLanguageChanged')
  })
  it('stays frozen when the lookup itself fails', async () => {
    save(frozenCreate)
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    vi.mocked(api.lookup).mockRejectedValue(new TypeError('Controlled network failure'))
    await act(() => view.result.current.submit())
    expect(api.create).not.toHaveBeenCalled()
    expect(view.result.current.record?.pending).toEqual(frozenCreate)
    expect(view.result.current.error).toBeDefined()
  })
  it('keeps a replace-recipient from being sent, and refreshes the organization status', async () => {
    save(frozenReplace, 'org-1')
    vi.mocked(api.progress).mockResolvedValue({ organizationId: 'org-1' } as never)
    const view = mount('org-1')
    await waitFor(() => expect(view.result.current.record?.pending).toEqual(frozenReplace))
    await act(() => view.result.current.submit())
    expect(api.recover).not.toHaveBeenCalled()
    expect(view.result.current.record?.pending).toBeUndefined()
    expect(view.result.current.notice).toBe('requestLanguageChanged')
  })
})
