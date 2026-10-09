import { z } from 'zod'

import {
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
 * Layers are kept apart: the membership baseline (independent of roles), exact facts for the current
 * organization row, and the actor hint (display only, never used to compare or attribute).
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

export const accessSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('membership') }),
  z.strictObject({
    kind: z.literal('rule'),
    via: accessSourceViaSchema,
    field: z.string().optional(),
    roleIds: z.array(memberIdSchema).max(ACCESS_ROLE_REFS_LIMIT),
    permissionId: memberIdSchema,
    presetId: z.string().nullable(),
    effect: z.enum(['allow', 'deny']),
    status: z.enum(['contributes', 'vetoes', 'overridden']),
  }),
])

export const accessItemSchema = z.strictObject({
  /** `<capabilityId>` or `<capabilityId>.<field>` for a field the capability can edit. */
  key: z.string(),
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
export type AccessItem = z.infer<typeof accessItemSchema>

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
    /** `null` means unknown (counterfactuals skipped), never "false". */
    breadth: z.boolean().nullable(),
    synergy: z.boolean().nullable(),
    vetoed: z.boolean().nullable(),
  }),
  /** Rules outside the supported catalogue; not covered by this summary. */
  uncovered: z.strictObject({
    ruleCount: z.number().int().nonnegative(),
    roleSample: z
      .array(z.strictObject({ id: memberIdSchema, name: z.string() }))
      .max(ACCESS_UNCOVERED_ROLE_SAMPLE),
  }),
  qualifiers: z.array(z.enum(['platformSuperAdmin'])),
})
export type MemberAccess = z.infer<typeof memberAccessSchema>
