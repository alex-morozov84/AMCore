import { Action, Subject } from '@amcore/shared'

import { ORG_READ_FIELDS } from '../../auth/casl/org-role-defaults'
import { CapabilityRegistry } from '../capability-registry.service'

import { type AccessInput } from './access-evaluator'
import type { StoredPolicyRule } from './access-facts'

import type { Organization } from '@/generated/prisma/client'

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
    ...over,
  }
}
