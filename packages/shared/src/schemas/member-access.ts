import { z } from 'zod'

import {
  ACCESS_AREAS_MAX,
  ACCESS_CONFIGURED_SOURCES_PER_ITEM,
  ACCESS_FIELDS_MAX,
  ACCESS_LIMITS_MAX,
  ACCESS_ROLE_REFS_LIMIT,
  ACCESS_ROLES_SHOWN,
  ACCESS_SOURCES_PER_ITEM,
  ACCESS_UNCOVERED_ROLE_SAMPLE,
} from './member-access-budget'
import { memberIdSchema } from './organization-members'

/**
 * Explanation of what a member can do in ONE organization through bearer membership, built from the
 * same rule evaluation the API uses to authorize. Language-agnostic: keys and enums, no prose.
 *
 * Three evaluations are kept apart and never mixed:
 * - `record`: an exact decision for the current organization row (the built-in operations);
 * - `configured`: what the role settings configure for any other registered capability, by
 *   independent areas. It is never a proof for one record and carries no `granted` flag;
 * - `notEvaluated`: the capability declared no evaluation. It is never "not allowed".
 */
export const accessReasonSchema = z.enum(['granted', 'noGrant', 'vetoed', 'missingPrerequisite'])
export const accessOriginSchema = z.enum(['single', 'combined'])
export const accessHintSchema = z.enum(['allowed', 'recordRequired', 'denied'])

/** A bounded set of roles with its true size. */
export const accessRoleRefsSchema = z.strictObject({
  roleIds: z.array(memberIdSchema).max(ACCESS_ROLE_REFS_LIMIT),
  total: z.number().int().nonnegative(),
})

export const accessSourceViaSchema = z.enum([
  'direct',
  'readPrerequisite',
  'deletePrerequisite',
  'teamAccessGate',
  'teamAccessVeto',
])

/** Independent areas of a configured right; one entry per kind, never merged into each other. */
export const accessAreaKindSchema = z.enum(['all', 'assigned', 'own', 'custom'])
export const accessPrerequisiteSchema = z.enum([
  'notRequired',
  'met',
  'unproven',
  'missing',
  'blocked',
])
/** Distinct causes of a limit, each shown with its own wording. */
export const accessLimitKindSchema = z.enum(['fields', 'condition', 'denyCondition', 'denyFields'])
export const configuredStateSchema = z.enum([
  'allowed',
  'configured',
  'blocked',
  'missingPrerequisite',
  'none',
])

export const accessSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('membership') }),
  z.strictObject({
    kind: z.literal('rule'),
    via: accessSourceViaSchema,
    field: z.string().optional(),
    roleIds: z.array(memberIdSchema).max(ACCESS_ROLE_REFS_LIMIT),
    /** Configured sources include the true role count; record sources keep their existing shape. */
    total: z.number().int().nonnegative().optional(),
    permissionId: memberIdSchema,
    presetId: z.string().nullable(),
    effect: z.enum(['allow', 'deny']),
    status: z.enum(['contributes', 'vetoes', 'overridden', 'restricts']),
    /** Configured items only: the area an allow rule belongs to and its own prerequisite. */
    area: accessAreaKindSchema.nullable().optional(),
    prerequisite: accessPrerequisiteSchema.nullable().optional(),
  }),
])

const fieldListSchema = z.array(z.string()).max(ACCESS_FIELDS_MAX)

export const accessAreaSchema = z.strictObject({
  kind: accessAreaKindSchema,
  roles: accessRoleRefsSchema,
  /** `null` = every field of the item; otherwise the union of the fields the rules cover. */
  fields: fieldListSchema.nullable(),
  /** Aggregated from the unmasked rules of the area, never from one of them. */
  prerequisite: accessPrerequisiteSchema,
  /** Every rule of the area is masked by a deny with the identical condition. */
  masked: z.boolean(),
  /** Informational: an unconditional unlimited area `all` already covers it. */
  absorbed: z.boolean(),
})
export type AccessArea = z.infer<typeof accessAreaSchema>

export const accessLimitSchema = z.strictObject({
  kind: accessLimitKindSchema,
  fields: fieldListSchema.optional(),
})
export type AccessLimit = z.infer<typeof accessLimitSchema>

const itemBase = {
  /** `<capabilityId>` or `<capabilityId>.<field>` for a field the capability can edit. */
  key: z.string(),
}

export const accessRecordItemSchema = z.strictObject({
  ...itemBase,
  evaluation: z.literal('record'),
  baseline: z.boolean(),
  granted: z.boolean(),
  /** `null` for a denied item when single-role counterfactuals were not computed. */
  reason: accessReasonSchema.nullable(),
  actorHint: accessHintSchema.nullable(),
  origin: accessOriginSchema.nullable(),
  reachedBy: accessRoleRefsSchema.nullable(),
  grantedBy: accessRoleRefsSchema.nullable(),
  vetoedBy: accessRoleRefsSchema.nullable(),
  sources: z.array(accessSourceSchema).max(ACCESS_SOURCES_PER_ITEM),
  sourcesTruncated: z.boolean(),
})

type ConfiguredShape = {
  state: z.infer<typeof configuredStateSchema>
  areas: AccessArea[]
  limits: AccessLimit[]
  blockedBy: z.infer<typeof accessRoleRefsSchema> | null
  sources: z.infer<typeof accessSourceSchema>[]
}

const distinct = (values: readonly string[]): boolean => new Set(values).size === values.length
const usable = (area: AccessArea): boolean =>
  ['met', 'unproven', 'notRequired'].includes(area.prerequisite)

/** The state matrix of a configured item; every row is covered by a positive and a negative test. */
export function configuredInvariants(item: ConfiguredShape): string | undefined {
  const { state, areas, limits, blockedBy, sources } = item
  const unmasked = areas.filter((area) => !area.masked)
  if (!distinct(areas.map((area) => area.kind))) return 'areaKinds'
  if (!distinct(limits.map((limit) => limit.kind))) return 'limitKinds'
  if (
    sources.some(
      (source) =>
        source.kind === 'rule' && source.total !== undefined && source.total < source.roleIds.length
    )
  )
    return 'sourceRoleTotal'
  for (const limit of limits) {
    const listed = limit.kind === 'fields' || limit.kind === 'denyFields'
    if (listed !== Boolean(limit.fields?.length)) return 'limitFields'
  }
  if (areas.some((area) => area.masked && area.absorbed)) return 'maskedAbsorbed'
  if (state !== 'allowed' && areas.some((area) => area.absorbed)) return 'absorbedState'
  if (
    unmasked.some(
      (area) =>
        !area.absorbed &&
        area.prerequisite === 'met' &&
        sources.some(
          (source) =>
            source.kind === 'rule' &&
            source.effect === 'allow' &&
            source.status === 'contributes' &&
            source.area === area.kind &&
            source.prerequisite !== 'met'
        )
    )
  )
    return 'areaPrerequisite'
  switch (state) {
    case 'none':
      return areas.length || limits.length || blockedBy || sources.length ? 'none' : undefined
    case 'blocked':
      return areas.length === 0 ||
        !blockedBy ||
        blockedBy.total === 0 ||
        !(
          sources.some(
            (source) =>
              source.kind === 'rule' && source.effect === 'deny' && source.status === 'vetoes'
          ) ||
          (areas.every((area) => area.masked) &&
            sources.length > 0 &&
            sources.every(
              (source) =>
                source.kind === 'rule' &&
                source.effect === 'allow' &&
                source.status === 'overridden'
            ))
        )
        ? 'blocked'
        : undefined
    case 'missingPrerequisite':
      return unmasked.length === 0 ||
        unmasked.some((area) => area.prerequisite !== 'missing') ||
        blockedBy ||
        sources.length === 0
        ? 'missingPrerequisite'
        : undefined
    case 'configured':
      return !unmasked.some(usable) ||
        unmasked.every((area) => area.prerequisite === 'missing') ||
        blockedBy ||
        sources.length === 0
        ? 'configured'
        : undefined
    case 'allowed': {
      const open = areas.filter((area) => !area.absorbed)
      const [only] = open
      return open.length !== 1 ||
        only?.kind !== 'all' ||
        only.masked ||
        only.fields !== null ||
        !['met', 'notRequired'].includes(only.prerequisite) ||
        areas.some((area) => area.masked) ||
        limits.length > 0 ||
        blockedBy ||
        sources.length === 0
        ? 'allowed'
        : undefined
    }
  }
}

export const accessConfiguredItemSchema = z
  .strictObject({
    ...itemBase,
    evaluation: z.literal('configured'),
    baseline: z.literal(false),
    state: configuredStateSchema,
    areas: z.array(accessAreaSchema).max(ACCESS_AREAS_MAX),
    limits: z.array(accessLimitSchema).max(ACCESS_LIMITS_MAX),
    /** Roles whose deny rule (or team veto) blocks the item, when `state` is `blocked`. */
    blockedBy: accessRoleRefsSchema.nullable(),
    sources: z.array(accessSourceSchema).max(ACCESS_CONFIGURED_SOURCES_PER_ITEM),
    sourcesTruncated: z.boolean(),
  })
  .superRefine((item, ctx) => {
    const invariant = configuredInvariants(item)
    if (invariant) ctx.addIssue({ code: 'custom', params: { invariant } })
  })

export const accessNotEvaluatedItemSchema = z.strictObject({
  ...itemBase,
  evaluation: z.literal('notEvaluated'),
  baseline: z.literal(false),
  reason: z.literal('optOut'),
  sources: z.array(accessSourceSchema).max(0),
  sourcesTruncated: z.literal(false),
})

export const accessItemSchema = z.discriminatedUnion('evaluation', [
  accessRecordItemSchema,
  accessConfiguredItemSchema,
  accessNotEvaluatedItemSchema,
])
export type AccessItem = z.infer<typeof accessItemSchema>
export type AccessRecordItem = z.infer<typeof accessRecordItemSchema>
export type AccessConfiguredItem = z.infer<typeof accessConfiguredItemSchema>

export const memberAccessSchema = z.strictObject({
  member: z.strictObject({
    memberId: memberIdSchema,
    userId: memberIdSchema,
    name: z.string().nullable(),
    email: z.string(),
  }),
  aclVersion: z.number().int().nonnegative(),
  scope: z.literal('organization-membership'),
  roles: z.strictObject({
    total: z.number().int().nonnegative(),
    items: z
      .array(z.strictObject({ id: memberIdSchema, name: z.string(), isSystem: z.boolean() }))
      .max(ACCESS_ROLES_SHOWN),
    truncated: z.boolean(),
  }),
  /** Persisted links to roles outside this organization; they never count toward authority. */
  unsafeLinkCount: z.number().int().nonnegative(),
  items: z.array(accessItemSchema),
  widening: z.strictObject({
    status: z.enum(['computed', 'unavailable']),
    reason: z.enum(['roleLimit', 'ruleLimit']).optional(),
    /** The flags consider only `record` items; nothing is claimed about configured ones. */
    scope: z.literal('exactItems'),
    /** Items with another evaluation than `record`, any state; the flags did not consider them. */
    excludedItems: z.number().int().nonnegative(),
    /** `null` means unknown (counterfactuals skipped), never "false". */
    breadth: z.boolean().nullable(),
    synergy: z.boolean().nullable(),
    vetoed: z.boolean().nullable(),
  }),
  /** Rules no evaluated capability explains; not covered by this summary. */
  uncovered: z.strictObject({
    ruleCount: z.number().int().nonnegative(),
    roleSample: z
      .array(z.strictObject({ id: memberIdSchema, name: z.string() }))
      .max(ACCESS_UNCOVERED_ROLE_SAMPLE),
  }),
  qualifiers: z.array(z.enum(['platformSuperAdmin'])),
})
export type MemberAccess = z.infer<typeof memberAccessSchema>
