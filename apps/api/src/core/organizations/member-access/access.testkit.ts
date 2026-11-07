import { Action, Subject } from '@amcore/shared'

import type { Organization } from '../../../generated/prisma/client.js'
import { ORG_READ_FIELDS } from '../../auth/casl/org-role-defaults.js'
import { CAPABILITY_ADAPTERS, CapabilityRegistry } from '../capability-registry.service.js'

import {
  type AccessCapability,
  defaultCapabilities,
  type PresetTemplate,
} from './access-capabilities.js'
import { type AccessInput } from './access-evaluator.js'
import type { StoredPolicyRule } from './access-facts.js'

/** Keep starter truth tables independent of capabilities registered by a product. */
const BUILT_IN_CAPABILITY_IDS = [
  'teamAccess.manage',
  'organization.read',
  'organization.update',
  'organization.delete',
] as const

const starterCapabilities = (): readonly AccessCapability[] => {
  const catalogue = defaultCapabilities()
  return BUILT_IN_CAPABILITY_IDS.map((id) => {
    const capability = catalogue.find((entry) => entry.id === id)
    if (!capability) throw new Error(`Missing built-in test capability: ${id}`)
    return capability
  })
}

export const ORG_ID = 'org-1'
export const USER_ID = 'user-1'
export const registry = new CapabilityRegistry()

export const organization: Organization = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  aclVersion: 7,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

export const rule = (
  id: string,
  action: string,
  subject: string,
  options: {
    fields?: string[]
    conditions?: Record<string, unknown> | null
    inverted?: boolean
  } = {}
): StoredPolicyRule => ({
  id,
  action,
  subject,
  conditions: options.conditions ?? null,
  fields: options.fields ?? [],
  inverted: options.inverted ?? false,
})

/** Unconditional allow to read every organization field. */
export const readAll = (id: string): StoredPolicyRule =>
  rule(id, Action.Read, Subject.Organization, { fields: [...ORG_READ_FIELDS] })

interface RoleSpec {
  id: string
  name?: string
  isSystem?: boolean
  rules: StoredPolicyRule[]
}

/** Builds an input from roles and their rules; a rule id repeated across roles is one shared permission. */
export function input(roles: RoleSpec[], over: Partial<AccessInput> = {}): AccessInput {
  const rules = new Map<string, StoredPolicyRule>()
  const ruleIdsByRole = new Map<string, string[]>()
  for (const role of roles) {
    ruleIdsByRole.set(
      role.id,
      role.rules.map((entry) => entry.id)
    )
    for (const entry of role.rules) rules.set(entry.id, entry)
  }
  return {
    organization,
    member: {
      memberId: 'member-1',
      userId: USER_ID,
      name: 'Ada',
      email: 'ada@example.test',
      systemRole: 'USER',
    },
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name ?? role.id,
      isSystem: role.isSystem ?? false,
    })),
    ruleIdsByRole,
    rules,
    unsafeLinkCount: 0,
    registry,
    capabilities: starterCapabilities(),
    ...over,
  }
}

/**
 * A downstream-like domain: records with own / assigned / all areas, as the extension fixture
 * registers. The server only accepts rules on subjects it knows, so `Role` stands in for the
 * downstream subject here (the real subject is proven by the extension fixture end to end).
 */
const ORDER_SUBJECT = 'Role'
const AREA_CONDITIONS = {
  own: { organizationId: '${user.organizationId}' },
  // `${user.sub}` is only valid on fields a model has; a literal marks the assigned area here.
  assigned: { description: 'assigned' },
  all: null,
} as const

const orderPreset =
  (action: string, fields: string[]) =>
  (presetId: string): PresetTemplate => ({
    action,
    subject: ORDER_SUBJECT,
    conditions: AREA_CONDITIONS[presetId as keyof typeof AREA_CONDITIONS],
    fields,
    inverted: false,
  })

export const ORDER_READ: AccessCapability = {
  id: 'syntheticOrder.read',
  subject: ORDER_SUBJECT,
  action: 'read',
  editableFields: [],
  presets: ['own', 'assigned', 'all'],
  requiredReadFields: ['id', 'name'],
  teamAccess: false,
  preset: orderPreset('read', []),
}

export const ORDER_UPDATE: AccessCapability = {
  id: 'syntheticOrder.update',
  subject: ORDER_SUBJECT,
  action: 'update',
  editableFields: ['name', 'description'],
  presets: ['own', 'assigned', 'all'],
  requiredReadFields: ['id', 'name'],
  teamAccess: false,
  preset: orderPreset('update', ['name', 'description']),
}

// The classifier also reads the real registry; synthetic fixtures must stay outside it.
for (const { id } of [ORDER_READ, ORDER_UPDATE]) {
  if (id in CAPABILITY_ADAPTERS) {
    throw new Error(`Rename the synthetic test capability: ${id} is registered by the product`)
  }
}

export const orderCapabilities = (...extra: AccessCapability[]): readonly AccessCapability[] => [
  ...starterCapabilities(),
  ORDER_READ,
  ORDER_UPDATE,
  ...extra,
]

/** A rule exactly as the editor's preset stores it. */
export const orderPresetRule = (
  id: string,
  kind: 'read' | 'update',
  area: 'own' | 'assigned' | 'all'
): StoredPolicyRule =>
  rule(id, kind, ORDER_SUBJECT, {
    conditions: AREA_CONDITIONS[area],
    fields: kind === 'update' ? ['name', 'description'] : [],
  })
