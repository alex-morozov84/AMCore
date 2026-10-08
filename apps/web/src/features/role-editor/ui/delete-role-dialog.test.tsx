import { createTranslator, NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type RoleDefinitionDetail } from '@amcore/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DeleteRoleDialog } from './delete-role-dialog'

vi.mock('client-only', () => ({}))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))

// The catalogue of the project's default locale, loaded by code so no locale file is hard-wired.
const messages = (await import(`../../../../messages/${DEFAULT_LOCALE}.json`)).default
const t = messages.organizationRoles
const say = createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: 'organizationRoles' })

const detail = (over: Partial<RoleDefinitionDetail> = {}): RoleDefinitionDetail => ({
  role: { id: 'r1', name: 'Support', description: null, isSystem: false, organizationId: 'o' },
  aclVersion: 4,
  editMode: 'editable',
  selfHeld: false,
  grantsFullControl: false,
  ruleCount: 0,
  managedPresets: [],
  advancedRules: [],
  holders: { total: 1, sample: [], truncated: false },
  impact: { liveInvitationCount: 0 },
  ...over,
})

const remove = vi.fn()
const role = { busy: false, remove } as never
const view = (d: RoleDefinitionDetail) => (
  <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
    <DeleteRoleDialog role={role} detail={d} disabled={false} onDeleted={vi.fn()} />
  </NextIntlClientProvider>
)

beforeEach(() => {
  vi.clearAllMocks()
  remove.mockResolvedValue({ status: 'committed', result: {}, followup: 'ready' })
})

describe('DeleteRoleDialog', () => {
  it('sends exactly what was acknowledged', async () => {
    render(view(detail()))
    fireEvent.click(screen.getByRole('button', { name: t.delete }))
    const dialog = await screen.findByRole('dialog', { name: t.deleteTitle })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: t.deleteAck }))
    fireEvent.click(within(dialog).getByRole('button', { name: t.deleteConfirm }))
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove.mock.calls[0][0]).toMatchObject({
      expectedAclVersion: 4,
      expectedLiveInvitationCount: 0,
    })
  })

  it('drops the acknowledgment when the numbers or revision change while open', async () => {
    const { rerender } = render(view(detail()))
    fireEvent.click(screen.getByRole('button', { name: t.delete }))
    const dialog = await screen.findByRole('dialog', { name: t.deleteTitle })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: t.deleteAck }))
    rerender(view(detail({ aclVersion: 5, holders: { total: 99, sample: [], truncated: false } })))
    expect(within(dialog).getByText(t.deleteImpactChanged)).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    const confirm = within(dialog).getByRole('button', { name: t.deleteConfirm })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(remove).not.toHaveBeenCalled()
    // The old numbers stay visible until the person chooses to review the new ones.
    expect(within(dialog).getByText(say('deletePeople', { holders: 1 }))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: t.reviewCurrent }))
    expect(within(dialog).getByText(say('deletePeople', { holders: 99 }))).toBeInTheDocument()
    const again = within(dialog).getByRole('checkbox', { name: t.deleteAck })
    expect(again).not.toBeChecked()
    expect(within(dialog).getByRole('button', { name: t.deleteConfirm })).toBeDisabled()
    fireEvent.click(again)
    fireEvent.click(within(dialog).getByRole('button', { name: t.deleteConfirm }))
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove.mock.calls[0][0]).toMatchObject({ expectedAclVersion: 5 })
  })

  it('does not let an empty role become affected without a new acknowledgment', async () => {
    const { rerender } = render(
      view(detail({ holders: { total: 0, sample: [], truncated: false } }))
    )
    fireEvent.click(screen.getByRole('button', { name: t.delete }))
    const dialog = await screen.findByRole('dialog', { name: t.deleteTitle })
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    rerender(
      view(
        detail({
          holders: { total: 3, sample: [], truncated: false },
          impact: { liveInvitationCount: 2 },
        })
      )
    )
    expect(within(dialog).getByRole('button', { name: t.deleteConfirm })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: t.reviewCurrent }))
    expect(within(dialog).getByRole('checkbox', { name: t.deleteAck })).not.toBeChecked()
  })

  it('treats an invitation that expired without a new revision as a change too', async () => {
    const { rerender } = render(view(detail({ impact: { liveInvitationCount: 2 } })))
    fireEvent.click(screen.getByRole('button', { name: t.delete }))
    const dialog = await screen.findByRole('dialog', { name: t.deleteTitle })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: t.deleteAck }))
    rerender(view(detail({ impact: { liveInvitationCount: 1 } })))
    expect(within(dialog).getByRole('button', { name: t.deleteConfirm })).toBeDisabled()
  })
})
