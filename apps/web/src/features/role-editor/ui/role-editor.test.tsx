import { NextIntlClientProvider } from 'next-intl'
import { CAPABILITY_CATALOGUE, DEFAULT_LOCALE, type RoleDefinitionDetail } from '@amcore/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import messages from '../../../../messages/en.json'

import { RoleEditor } from './role-editor'

vi.mock('client-only', () => ({}))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const t = messages.organizationRoles
const detail = (over: Partial<RoleDefinitionDetail> = {}): RoleDefinitionDetail => ({
  role: { id: 'r1', name: 'Support', description: null, isSystem: false, organizationId: 'o' },
  aclVersion: 4,
  editMode: 'editable',
  selfHeld: false,
  grantsFullControl: false,
  ruleCount: 0,
  managedPresets: [],
  advancedRules: [],
  holders: { total: 0, sample: [], truncated: false },
  impact: { liveInvitationCount: 0 },
  ...over,
})

const save = vi.fn()
const remove = vi.fn()
const onLeave = vi.fn()
const role = () => ({ busy: false, save, remove, data: undefined, refresh: vi.fn() }) as never

function show(d: RoleDefinitionDetail) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <RoleEditor
        role={role()}
        detail={d}
        capabilities={CAPABILITY_CATALOGUE as never}
        onDeleted={vi.fn()}
        onLeave={onLeave}
        onReview={vi.fn()}
      />
    </NextIntlClientProvider>
  )
}

const level = (group: RegExp, label: string) =>
  within(screen.getByRole('group', { name: group })).getByRole('checkbox', { name: label })

beforeEach(() => {
  vi.clearAllMocks()
  save.mockResolvedValue({ status: 'committed', result: {}, followup: 'ready' })
})

describe('RoleEditor', () => {
  it('shows no action bar until something changes, then offers save and discard', () => {
    show(detail())
    expect(screen.queryByRole('button', { name: t.save })).toBeNull()
    fireEvent.click(level(/View the organization/, t.levels.all))
    expect(screen.getByText(t.unsaved)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.discard }))
    expect(screen.queryByRole('button', { name: t.save })).toBeNull()
  })

  it('asks to confirm full control, sends nothing on cancel and the acknowledgment on confirm', async () => {
    show(detail())
    fireEvent.click(level(/Manage roles and members/, t.levels.all))
    fireEvent.click(screen.getByRole('button', { name: t.save }))
    const dialog = await screen.findByRole('alertdialog', { name: t.fullControlTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: t.cancel }))
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t.save }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: t.fullControlConfirm,
      })
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0]).toMatchObject({
      expectedAclVersion: 4,
      acknowledgeFullControl: true,
    })
  })

  it('asks the self-held confirmation when the person changes a role they hold', async () => {
    show(detail({ selfHeld: true }))
    fireEvent.click(level(/View the organization/, t.levels.own))
    fireEvent.click(screen.getByRole('button', { name: t.save }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: t.selfHeldTitle })).getByRole(
        'button',
        {
          name: t.selfHeldConfirm,
        }
      )
    )
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ acknowledgeSelfHeld: true })
  })

  it('turns a stale revision into a visible review prompt and disables saving', async () => {
    save.mockResolvedValue({
      status: 'rejected',
      error: new ApiRequestError(409, {
        statusCode: 409,
        errorCode: 'ROLE_DEFINITION_CONFLICT',
        message: 'x',
        timestamp: '2026-10-08T00:00:00.000Z',
        path: '/x',
      } as never),
    })
    show(detail())
    fireEvent.click(level(/View the organization/, t.levels.all))
    fireEvent.click(screen.getByRole('button', { name: t.save }))
    expect(await screen.findByRole('button', { name: t.reviewCurrent })).toBeInTheDocument()
    expect(screen.getByText(t.conflict)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.save })).toBeDisabled()
  })

  it('holds a link click while a draft exists and leaves only after confirmation', async () => {
    render(
      <>
        <RouteProgressLink href="/elsewhere">Elsewhere</RouteProgressLink>
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
          <RoleEditor
            role={role()}
            detail={detail()}
            capabilities={CAPABILITY_CATALOGUE as never}
            onDeleted={vi.fn()}
            onLeave={onLeave}
            onReview={vi.fn()}
          />
        </NextIntlClientProvider>
      </>
    )
    fireEvent.click(level(/View the organization/, t.levels.all))
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    const dialog = await screen.findByRole('alertdialog', { name: t.leaveTitle })
    expect(onLeave).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: t.leaveConfirm }))
    expect(onLeave).toHaveBeenCalledWith('/elsewhere')
  })

  it('does not hold navigation when nothing changed', () => {
    render(
      <>
        <RouteProgressLink href="/elsewhere">Elsewhere</RouteProgressLink>
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
          <RoleEditor
            role={role()}
            detail={detail()}
            capabilities={CAPABILITY_CATALOGUE as never}
            onDeleted={vi.fn()}
            onLeave={onLeave}
            onReview={vi.fn()}
          />
        </NextIntlClientProvider>
      </>
    )
    const click = fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(click).toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks no acknowledgment to delete a role nobody holds, but does when people are affected', async () => {
    const { unmount } = show(detail())
    fireEvent.click(screen.getByRole('button', { name: t.delete }))
    const empty = await screen.findByRole('dialog', { name: t.deleteTitle })
    expect(within(empty).queryByRole('checkbox')).toBeNull()
    expect(within(empty).getByRole('button', { name: t.deleteConfirm })).toBeEnabled()
    unmount()
    show(
      detail({
        holders: { total: 3, sample: [], truncated: false },
        impact: { liveInvitationCount: 2 },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: t.delete }))
    const affected = await screen.findByRole('dialog', { name: t.deleteTitle })
    expect(within(affected).getByText('3 people will lose this role.')).toBeInTheDocument()
    expect(within(affected).getByRole('button', { name: t.deleteConfirm })).toBeDisabled()
    fireEvent.click(within(affected).getByRole('checkbox', { name: t.deleteAck }))
    expect(within(affected).getByRole('button', { name: t.deleteConfirm })).toBeEnabled()
  })

  it('offers no editing for a built-in role', () => {
    show(detail({ editMode: 'system', managedPresets: null }))
    expect(screen.queryByRole('button', { name: t.delete })).toBeNull()
    expect(screen.queryByText(t.capabilitiesTitle)).toBeNull()
  })
})
