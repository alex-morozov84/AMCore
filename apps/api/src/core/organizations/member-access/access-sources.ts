import { subject as caslSubject } from '@casl/ability'

import { Action, type MemberAccess, Subject } from '@amcore/shared'
import { ACCESS_ROLE_REFS_LIMIT, ACCESS_SOURCES_PER_ITEM } from '@amcore/shared'

import { ORG_READ_FIELDS } from '../../auth/casl/org-role-defaults'
import type { AbilityPermission } from '../../auth/casl/permission-normalization'
import { createPrismaAbility } from '../../auth/casl/prisma-ability'
import { classifyStoredRule } from '../role-definition-classifier'

import type { ItemSpec } from './access-capabilities'
import type { StoredPolicyRule } from './access-facts'

import type { Organization } from '@/generated/prisma/client'

type Source = Extract<MemberAccess['items'][number]['sources'][number], { kind: 'rule' }>
type Via = Source['via']

/** Inverted rules on these subjects veto team administration whatever their action, fields or conditions. */
const TEAM_VETO_SUBJECTS = new Set<string>([
  Subject.TeamAccess,
  Subject.Role,
  Subject.Permission,
  Subject.User,
  Subject.All,
])
const ORG_SUBJECTS = new Set<string>([Subject.Organization, Subject.All])
const STATUS_ORDER = { vetoes: 0, restricts: 1, contributes: 2, overridden: 3 } as const
const VIA_ORDER: Via[] = [
  'teamAccessVeto',
  'direct',
  'readPrerequisite',
  'deletePrerequisite',
  'teamAccessGate',
]

export const roleRefs = (ids: Iterable<string>): { roleIds: string[]; total: number } => {
  const all = [...new Set(ids)].sort()
  return { roleIds: all.slice(0, ACCESS_ROLE_REFS_LIMIT), total: all.length }
}

export interface SourceContext {
  /** The whole policy after validation, interpolation and ordering. */
  policy: readonly AbilityPermission[]
  /** Roles that link each permission, before de-duplication. */
  rolesByRule: ReadonlyMap<string, readonly string[]>
  /** Rules as stored, for preset recognition. */
  stored: ReadonlyMap<string, StoredPolicyRule>
  organization: Organization
}

/**
 * Does this rule apply to the current organization row for the action (and field)? This follows the
 * CASL matching the API uses: conditions are evaluated against the row; a rule with a field list
 * matches a field-less check only when it allows (an inverted field-limited rule does not).
 */
function applies(
  rule: AbilityPermission,
  action: string,
  organization: Organization,
  field?: string
): boolean {
  if (!ORG_SUBJECTS.has(rule.subject)) return false
  if (rule.action !== action && rule.action !== Action.Manage) return false
  const conditions = rule.conditions as Record<string, unknown> | null
  const ability = createPrismaAbility([
    { action: rule.action, subject: rule.subject, ...(conditions && { conditions }) },
  ] as never)
  if (!ability.can(action, caslSubject('Organization', organization) as never)) return false
  const fields = rule.fields
  if (fields.length === 0 || fields.includes('*')) return true
  if (field === undefined) return !rule.inverted
  return fields.includes(field)
}

interface Draft extends Omit<Source, 'roleIds'> {
  roles: string[]
}

class Collector {
  private readonly drafts = new Map<string, Draft>()
  directAllow = false
  vetoRoles = new Set<string>()
  /** Stored rules that block this item; removing them is the question "would it be granted?". */
  vetoRules = new Set<string>()

  constructor(
    private readonly context: SourceContext,
    private readonly granted: boolean
  ) {}

  add(rule: AbilityPermission, via: Via, field?: string): void {
    const effect = rule.inverted ? 'deny' : 'allow'
    const status = rule.inverted ? 'vetoes' : this.granted ? 'contributes' : 'overridden'
    const roles = this.context.rolesByRule.get(rule.id) ?? []
    if (via === 'direct' && effect === 'allow') this.directAllow = true
    if (status === 'vetoes') {
      roles.forEach((id) => this.vetoRoles.add(id))
      this.vetoRules.add(rule.id)
    }
    const stored = this.context.stored.get(rule.id)
    const classified = stored ? classifyStoredRule(stored) : { kind: 'advanced' as const }
    const key = `${rule.id}|${via}|${field ?? ''}`
    this.drafts.set(key, {
      kind: 'rule',
      via,
      ...(field !== undefined && { field }),
      roles: [...roles],
      permissionId: rule.id,
      presetId: classified.kind === 'preset' ? classified.presetId : null,
      effect,
      status,
    })
  }

  result(): { sources: Source[]; truncated: boolean } {
    const ordered = [...this.drafts.values()].sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        VIA_ORDER.indexOf(a.via) - VIA_ORDER.indexOf(b.via) ||
        (a.permissionId < b.permissionId ? -1 : a.permissionId > b.permissionId ? 1 : 0)
    )
    const sources = ordered.slice(0, ACCESS_SOURCES_PER_ITEM).map(({ roles, ...rest }) => ({
      ...rest,
      roleIds: roleRefs(roles).roleIds,
    }))
    return { sources, truncated: ordered.length > ACCESS_SOURCES_PER_ITEM }
  }
}

function teamGate(collector: Collector, policy: readonly AbilityPermission[]): void {
  for (const rule of policy) {
    if (!rule.inverted && rule.action === Action.Manage && rule.subject === Subject.TeamAccess)
      collector.add(rule, 'teamAccessGate')
    if (rule.inverted && TEAM_VETO_SUBJECTS.has(rule.subject)) collector.add(rule, 'teamAccessVeto')
  }
}

function readPrerequisite(collector: Collector, context: SourceContext): void {
  for (const rule of context.policy) {
    if (!ORG_SUBJECTS.has(rule.subject)) continue
    if (rule.inverted) {
      const field = ORG_READ_FIELDS.find((f) => applies(rule, Action.Read, context.organization, f))
      if (field) collector.add(rule, 'readPrerequisite', field)
    } else if (rule.action === Action.Read) {
      if (ORG_READ_FIELDS.some((f) => applies(rule, Action.Read, context.organization, f)))
        collector.add(rule, 'readPrerequisite')
    }
  }
}

function direct(
  collector: Collector,
  context: SourceContext,
  action: Action,
  field?: string
): void {
  for (const rule of context.policy)
    if (applies(rule, action, context.organization, field)) collector.add(rule, 'direct', field)
}

function deletePrerequisite(collector: Collector, context: SourceContext): void {
  for (const rule of context.policy) {
    if (!ORG_SUBJECTS.has(rule.subject) || rule.fields.length === 0) continue
    if (rule.action !== Action.Delete && rule.action !== Action.Manage) continue
    const field = ORG_READ_FIELDS.find((f) => applies(rule, Action.Delete, context.organization, f))
    if (field) collector.add(rule, 'deletePrerequisite', rule.inverted ? field : undefined)
  }
}

/**
 * Why this item is (not) granted, following the same dependencies as the evaluators: the item's own
 * rules, the read fields an update needs, the delete fields a delete needs and the team-access gate
 * with its policy-wide vetoes. Derived after the whole policy was evaluated, so an entry never
 * claims to be the final winner. Capabilities this module does not know get no sources.
 */
export function sourcesFor(
  spec: ItemSpec,
  granted: boolean,
  context: SourceContext
): {
  sources: Source[]
  truncated: boolean
  directAllow: boolean
  vetoRoles: string[]
  vetoRules: string[]
} {
  const collector = new Collector(context, granted)
  switch (spec.capability.id) {
    case 'teamAccess.manage':
      teamGate(collector, context.policy)
      break
    case 'organization.update':
      direct(collector, context, Action.Update, spec.field)
      readPrerequisite(collector, context)
      break
    case 'organization.delete':
      direct(collector, context, Action.Delete)
      deletePrerequisite(collector, context)
      teamGate(collector, context.policy)
      break
    default:
      break
  }
  return {
    ...collector.result(),
    directAllow: collector.directAllow,
    vetoRoles: [...collector.vetoRoles],
    vetoRules: [...collector.vetoRules],
  }
}
