import { createTranslator, NextIntlClientProvider } from 'next-intl'
import {
  type AccessConfiguredItem,
  type AccessRecordItem,
  CAPABILITY_CATALOGUE,
  DEFAULT_LOCALE,
  type MemberAccess,
} from '@amcore/shared'
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

const item = (over: Partial<AccessRecordItem>): AccessRecordItem => ({
  evaluation: 'record',
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
          roleIds: ['rA'],
          permissionId: 'p0',
          presetId: null,
          effect: 'allow',
          status: 'overridden',
        },
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
  widening: {
    status: 'computed',
    scope: 'exactItems',
    excludedItems: 0,
    breadth: true,
    synergy: false,
    vetoed: true,
  },
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
    expect(screen.getByText(t.included)).toBeInTheDocument()
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
    expect(screen.getByText(say('otherTitle', { count: 2 }))).toBeInTheDocument()
    expect(screen.getByText(t.otherBody)).toBeInTheDocument()
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
          scope: 'exactItems',
          excludedItems: 0,
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
    expect(within(row).getByText(say('why.blocks', { roles: 'Auditor' }))).toBeInTheDocument()
    expect(within(row).getByText(t.why.denyWins)).toBeInTheDocument()
    expect(within(row).getByText(say('why.allows', { roles: 'Support' }))).toBeInTheDocument()
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

  it('hides cached identity and access facts when authority is lost', () => {
    const rendered = view()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    state.access = { data: access(), ready: false, available: false, pending: false }
    state.catalogue = { ...state.catalogue, ready: false, available: false }
    rendered.rerender(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
        <MemberAccessDialog
          controller={{ refresh: vi.fn() } as never}
          userId="u1"
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>
    )
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    expect(screen.queryByText('ada@example.test')).toBeNull()
    expect(screen.queryByText(roles.teamAccessManagement.label)).toBeNull()
  })
})

describe('MemberAccessDialog: capabilities a product registers', () => {
  const ORDER = {
    ...CAPABILITY_CATALOGUE[0],
    id: 'order.update',
    subject: 'Order',
    labelKey: 'orderUpdate',
    editableFields: ['status'],
  }
  const refs = { roleIds: ['rA'], total: 1 }
  const area = (kind: 'all' | 'assigned' | 'own' | 'custom', over = {}) => ({
    kind,
    roles: refs,
    fields: null,
    prerequisite: 'met' as const,
    masked: false,
    absorbed: false,
    ...over,
  })
  const configured = (over: Partial<AccessConfiguredItem> = {}): AccessConfiguredItem => ({
    key: 'order.update',
    evaluation: 'configured',
    baseline: false,
    state: 'configured',
    areas: [area('assigned')],
    limits: [],
    blockedBy: null,
    sources: [
      {
        kind: 'rule',
        via: 'direct',
        roleIds: ['rA'],
        permissionId: 'p1',
        presetId: 'assigned',
        effect: 'allow',
        status: 'contributes',
        area: 'assigned',
        prerequisite: 'met',
      },
    ],
    sourcesTruncated: false,
    ...over,
  })
  const show = (items: MemberAccess['items']) => {
    state.catalogue = {
      data: { capabilities: [...CAPABILITY_CATALOGUE, ORDER] },
      ready: true,
      available: true,
      pending: false,
    }
    state.access = {
      data: access({ items, uncovered: { ruleCount: 0, roleSample: [] } }),
      ready: true,
      available: true,
      pending: false,
    }
    view()
  }

  it('lists a configured right by area with its roles, and says it is not a record check', () => {
    show([configured()])
    const row = screen.getByText('order.update').closest('li')!
    expect(within(row).getByText(t.configuredBadge)).toBeInTheDocument()
    expect(
      within(row).getByText(say('areaRoles', { area: t.area.assigned, roles: 'Support' }))
    ).toBeInTheDocument()
    expect(screen.getByText(t.configuredNote)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(say('summaryConfigured', { count: 1 })))).toBeInTheDocument()
  })

  it('shows two independent areas and the prerequisite it cannot prove', () => {
    show([
      configured({
        areas: [area('assigned', { prerequisite: 'unproven' }), area('own')],
      }),
    ])
    const row = screen.getByText('order.update').closest('li')!
    expect(within(row).getAllByText(new RegExp(t.area.assigned)).length).toBeGreaterThan(0)
    expect(within(row).getAllByText(new RegExp(t.area.own)).length).toBeGreaterThan(0)
    expect(within(row).getByText(t.prerequisite.unproven)).toBeInTheDocument()
  })

  it('words every limit by its own cause', () => {
    show([
      configured({
        areas: [area('custom', { fields: ['status'] })],
        limits: [
          { kind: 'fields', fields: ['status'] },
          { kind: 'condition' },
          { kind: 'denyCondition' },
          { kind: 'denyFields', fields: ['note'] },
        ],
      }),
    ])
    expect(screen.getByText(say('limit.fields', { fields: 'status' }))).toBeInTheDocument()
    expect(screen.getByText(t.limit.condition)).toBeInTheDocument()
    expect(screen.getByText(t.limit.denyCondition)).toBeInTheDocument()
    expect(screen.getByText(say('limit.denyFields', { fields: 'note' }))).toBeInTheDocument()
  })

  it('names who blocks a blocked configured right and keeps the rules behind it', () => {
    show([
      configured({
        state: 'blocked',
        areas: [area('own', { masked: true })],
        blockedBy: { roleIds: ['rC'], total: 1 },
        sources: [
          {
            kind: 'rule',
            via: 'direct',
            roleIds: ['rC'],
            permissionId: 'p2',
            presetId: null,
            effect: 'deny',
            status: 'vetoes',
            area: null,
            prerequisite: null,
          },
        ],
      }),
    ])
    const row = screen.getByText('order.update').closest('li')!
    expect(within(row).getByText(say('stateBlocked', { blockers: 'Auditor' }))).toBeInTheDocument()
    fireEvent.click(within(row).getByText(t.whyTitle))
    expect(
      within(row).getByText(say('whyConfigured.blocks', { roles: 'Auditor' }))
    ).toBeInTheDocument()
    expect(within(row).getByText(t.why.denyWins)).toBeInTheDocument()
  })

  it('puts "not evaluated" in its own group, never under "not allowed"', () => {
    show([
      configured({ key: 'order.update', state: 'none', areas: [], sources: [] }),
      {
        key: 'order.archive',
        evaluation: 'notEvaluated',
        baseline: false,
        reason: 'optOut',
        sources: [],
        sourcesTruncated: false,
      },
    ])
    expect(screen.getByText(say('notEvaluatedTitle', { count: 1 }))).toBeInTheDocument()
    expect(screen.getByText(t.notEvaluatedHint, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(say('notAllowedTitle', { count: 1 }))).toBeInTheDocument()
    const notEvaluated = screen
      .getByText(say('notEvaluatedTitle', { count: 1 }))
      .closest('details')!
    expect(within(notEvaluated).getByText('order.archive')).toBeInTheDocument()
    expect(within(notEvaluated).queryByText('order.update')).toBeNull()
  })

  it('an exact item still reads as before next to configured ones', () => {
    show([
      item({ key: 'organization.read', baseline: true, granted: true, reason: 'granted' }),
      configured(),
    ])
    expect(screen.getByText(t.baselineNote)).toBeInTheDocument()
    expect(screen.getByText(t.included)).toBeInTheDocument()
  })
})

describe('MemberAccessDialog: a long list', () => {
  const entries = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      ...CAPABILITY_CATALOGUE[0],
      id: `lot.op${index}`,
      subject: `Lot${index % 3}`,
      labelKey: `lotOp${index}`,
      editableFields: [] as string[],
    }))
  const longItems = (count: number): MemberAccess['items'] =>
    Array.from({ length: count }, (_, index) => ({
      key: `lot.op${index}`,
      evaluation: 'configured' as const,
      baseline: false as const,
      state: 'configured' as const,
      areas: [
        {
          kind: 'own' as const,
          roles: { roleIds: ['rA'], total: 1 },
          fields: null,
          prerequisite: 'met' as const,
          masked: false,
          absorbed: false,
        },
      ],
      limits: [],
      blockedBy: null,
      sources: [],
      sourcesTruncated: false,
    }))
  const show = (count: number) => {
    state.catalogue = {
      data: { capabilities: [...CAPABILITY_CATALOGUE, ...entries(count)] },
      ready: true,
      available: true,
      pending: false,
    }
    state.access = {
      data: access({ items: longItems(count), uncovered: { ruleCount: 0, roleSample: [] } }),
      ready: true,
      available: true,
      pending: false,
    }
    view()
  }

  it('offers search and collapses big areas once the list is long', () => {
    show(30)
    const search = screen.getByRole('textbox', { name: t.searchLabel })
    expect(document.querySelectorAll('details[open]')).toHaveLength(0)
    fireEvent.change(search, { target: { value: 'lot.op7' } })
    expect(document.querySelectorAll('details[open]')).toHaveLength(1)
    fireEvent.change(search, { target: { value: 'nothing-here' } })
    expect(screen.getByText(t.noMatches)).toBeInTheDocument()
  })

  it('keeps a short list as it was: no search, no collapsing', () => {
    show(4)
    expect(screen.queryByRole('textbox', { name: t.searchLabel })).toBeNull()
  })
})
