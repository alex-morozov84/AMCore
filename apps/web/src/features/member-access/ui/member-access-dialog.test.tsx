import { createTranslator, NextIntlClientProvider } from 'next-intl'
import { CAPABILITY_CATALOGUE, DEFAULT_LOCALE, type MemberAccess } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Entity from '@/entities/organization-context'

import { MemberAccessDialog } from './member-access-dialog'

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  catalogue: {} as Record<string, unknown>,
}))
vi.mock('@/entities/organization-context', async (original) => ({
  ...(await original<typeof Entity>()),
  useMemberAccess: () => state.access,
  useCapabilityCatalogue: () => state.catalogue,
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// The catalogue of the project's default locale, loaded by code so no locale file is hard-wired.
const messages = (await import(`../../../../messages/${DEFAULT_LOCALE}.json`)).default
const t = messages.memberAccess
const say = createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: 'memberAccess' })
const roles = messages.organizationRoles.capabilities

const item = (over: Partial<MemberAccess['items'][number]>): MemberAccess['items'][number] => ({
  key: 'teamAccess.manage',
  baseline: false,
  granted: false,
  reason: 'noGrant',
  actorHint: null,
  origin: null,
  reachedBy: null,
  grantedBy: null,
  vetoedBy: null,
  sources: [],
  sourcesTruncated: false,
  ...over,
})
const access = (over: Partial<MemberAccess> = {}): MemberAccess => ({
  member: { memberId: 'm1', userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' },
  aclVersion: 4,
  scope: 'organization-membership',
  roles: {
    total: 2,
    items: [
      { id: 'rA', name: 'Support', isSystem: false },
      { id: 'rC', name: 'Auditor', isSystem: false },
    ],
    truncated: false,
  },
  unsafeLinkCount: 0,
  items: [
    item({ key: 'organization.read', baseline: true, granted: true, reason: 'granted' }),
    item({
      key: 'teamAccess.manage',
      granted: true,
      reason: 'granted',
      origin: 'single',
      reachedBy: { roleIds: ['rA'], total: 1 },
    }),
    item({ key: 'organization.update' }),
    item({
      key: 'organization.update.name',
      reason: 'vetoed',
      grantedBy: { roleIds: ['rA'], total: 1 },
      vetoedBy: { roleIds: ['rC'], total: 1 },
      sources: [
        {
          kind: 'rule',
          via: 'direct',
          field: 'name',
          roleIds: ['rC'],
          permissionId: 'p1',
          presetId: null,
          effect: 'deny',
          status: 'vetoes',
        },
      ],
    }),
    item({ key: 'organization.delete', reason: 'missingPrerequisite' }),
  ],
  widening: { status: 'computed', breadth: true, synergy: false, vetoed: true },
  uncovered: { ruleCount: 2, roleSample: [{ id: 'rA', name: 'Support' }] },
  qualifiers: [],
  ...over,
})

const view = (onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <MemberAccessDialog
        controller={{ refresh: vi.fn() } as never}
        userId="u1"
        onClose={onClose}
      />
    </NextIntlClientProvider>
  )

beforeEach(() => {
  state.access = { data: access(), ready: true, available: true, pending: false }
  state.catalogue = {
    data: { capabilities: CAPABILITY_CATALOGUE },
    ready: true,
    available: true,
    pending: false,
  }
})

describe('MemberAccessDialog', () => {
  it('names the person, the roles and each decision in the catalogue wording', () => {
    view()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getAllByText('Support').length).toBeGreaterThan(0)
    expect(screen.getByText(roles.teamAccessManagement.label)).toBeInTheDocument()
    expect(screen.getByText(t.baselineNote)).toBeInTheDocument()
    expect(screen.getByText(say('originSingle', { roles: 'Support' }))).toBeInTheDocument()
    expect(
      screen.getByText(say('reasonVetoed', { granted: 'Support', blockers: 'Auditor' }))
    ).toBeInTheDocument()
    expect(screen.queryByText(roles.organizationUpdate.label + ': ' + t.fields.name)).not.toBeNull()
  })

  it('explains the shape of the answer before the rows', () => {
    view()
    expect(screen.getByText(t.breadth)).toBeInTheDocument()
    expect(screen.getByText(t.vetoed)).toBeInTheDocument()
    expect(screen.queryByText(t.synergy)).toBeNull()
    expect(screen.getByText(say('uncovered', { count: 2 }), { exact: false })).toBeInTheDocument()
    expect(screen.getByText(new RegExp(say('summaryAllowed', { count: 1 })))).toBeInTheDocument()
  })

  it('keeps what is not allowed apart and leaves per-field repeats out', () => {
    view()
    expect(screen.getByText(say('notAllowedTitle', { count: 2 }))).toBeInTheDocument()
    expect(screen.getByText(t.reasonMissing)).toBeInTheDocument()
  })

  it('says a breakdown is unavailable instead of inventing one', () => {
    state.access = {
      data: access({
        widening: {
          status: 'unavailable',
          reason: 'roleLimit',
          breadth: null,
          synergy: null,
          vetoed: null,
        },
      }),
      ready: true,
      available: true,
      pending: false,
    }
    view()
    expect(screen.getByText(t.wideningUnavailable)).toBeInTheDocument()
    expect(screen.queryByText(t.breadth)).toBeNull()
  })

  it('shows the rules behind a decision on request', () => {
    view()
    const row = screen
      .getByText(
        say('fieldOf', { capability: roles.organizationUpdate.label, field: t.fields.name })
      )
      .closest('li')!
    fireEvent.click(within(row).getByText(t.whyTitle))
    expect(within(row).getByText(t.status.vetoes)).toBeInTheDocument()
    expect(within(row).getByText(say('sourceRoles', { roles: 'Auditor' }))).toBeInTheDocument()
  })

  it('shows a loading state, and never stale facts after a failed read', () => {
    state.access = { data: undefined, ready: true, available: false, pending: true }
    const { unmount } = view()
    expect(screen.getByText(t.loading)).toBeInTheDocument()
    unmount()
    state.access = {
      data: access(),
      ready: true,
      available: false,
      pending: false,
      error: new Error('x'),
    }
    view()
    expect(screen.queryByText(roles.teamAccessManagement.label)).toBeNull()
    expect(screen.getByText(t.unavailable)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.retry })).toBeEnabled()
  })

  it('keeps showing the answer during a background reread and closes on request', () => {
    state.access = { data: access(), ready: true, available: false, pending: true }
    const onClose = vi.fn()
    view(onClose)
    expect(screen.getByText(roles.teamAccessManagement.label)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.close }))
    expect(onClose).toHaveBeenCalled()
  })
})
