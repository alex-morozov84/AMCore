import { z } from 'zod'

import { ORGANIZATION_CONTEXT_ID_PATTERN } from '../constants/organization-context'

import { capabilityIdSchema } from './capability'
import {
  ROLE_EDITABLE_RULE_LIMIT,
  ROLE_HOLDER_SAMPLE_LIMIT,
  ROLE_LIST_MAX_OFFSET,
  ROLE_MANAGED_PERMISSION_IDS_LIMIT,
  ROLE_PRESET_SELECTION_LIMIT,
} from './role-definition-budget'

/**
 * Role-definition contracts: the editor reads and writes a role as ONE definition
 * (metadata + complete managed-preset selection) fenced by the organization revision.
 * Schemas are language-agnostic: no literal `message`, errors are stable codes.
 */
export const ROLE_NAME_MIN = 2
export const ROLE_NAME_MAX = 50
export const ROLE_DESCRIPTION_MAX = 255
/** Builtin template names a NEW or CHANGED custom name may not use (case-insensitive). */
export const RESERVED_ROLE_NAMES = ['ADMIN', 'MEMBER', 'VIEWER'] as const

export const roleIdSchema = z.string().regex(new RegExp(ORGANIZATION_CONTEXT_ID_PATTERN))
const count = z.number().int().nonnegative()
const revision = z.number().int().min(0).max(2_147_483_647)

export const rolePresetIdSchema = z.enum(['own', 'assigned', 'all'])
export const roleDefinitionPresetSchema = z.strictObject({
  capabilityId: capabilityIdSchema,
  presetId: rolePresetIdSchema,
})
export type RoleDefinitionPreset = z.infer<typeof roleDefinitionPresetSchema>

export const roleMetaSchema = z.strictObject({
  id: roleIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  organizationId: z.string().nullable(),
})
export type RoleMeta = z.infer<typeof roleMetaSchema>

export const roleAdvancedStateSchema = z.enum(['none', 'present', 'unknown'])
export const roleSummarySchema = roleMetaSchema.extend({
  holderCount: count,
  ruleCount: count,
  grantsFullControl: z.boolean(),
  advancedState: roleAdvancedStateSchema,
})
export type RoleSummary = z.infer<typeof roleSummarySchema>

const search = z
  .string()
  .trim()
  .refine((value) => [...value].length <= 100)
  .optional()
export const roleDefinitionListQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search,
  })
  .refine((query) => (query.page - 1) * query.limit <= ROLE_LIST_MAX_OFFSET)
export type RoleDefinitionListQuery = z.infer<typeof roleDefinitionListQuerySchema>

export const roleDefinitionListResponseSchema = z.strictObject({
  data: z.array(roleSummarySchema).max(100),
  total: count,
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(100),
  aclVersion: count,
})
export type RoleDefinitionListResponse = z.infer<typeof roleDefinitionListResponseSchema>

export const managedPresetSchema = roleDefinitionPresetSchema.extend({
  permissionIds: z.array(roleIdSchema).max(ROLE_MANAGED_PERMISSION_IDS_LIMIT),
  duplicateCount: count,
})
export type ManagedPreset = z.infer<typeof managedPresetSchema>

/** Stored rule the editor does not manage; shown read-only and never rewritten. */
export const advancedRuleSchema = z.strictObject({
  permissionId: roleIdSchema,
  action: z.string(),
  subject: z.string(),
  conditions: z.json().nullable(),
  fields: z.array(z.string()),
  inverted: z.boolean(),
})
export type AdvancedRule = z.infer<typeof advancedRuleSchema>

export const roleHolderSampleSchema = z.strictObject({
  memberId: roleIdSchema,
  userId: roleIdSchema,
  name: z.string().nullable(),
  email: z.string(),
})
export type RoleHolderSample = z.infer<typeof roleHolderSampleSchema>

export const roleEditModeSchema = z.enum(['editable', 'system', 'oversized'])

export const roleDefinitionDetailSchema = z.strictObject({
  role: roleMetaSchema,
  aclVersion: count,
  editMode: roleEditModeSchema,
  /** The calling actor currently holds this role in the organization. */
  selfHeld: z.boolean(),
  /** A stored non-inverted `manage:TeamAccess` rule exists (configured, not effective authority). */
  grantsFullControl: z.boolean(),
  ruleCount: count,
  managedPresets: z.array(managedPresetSchema).max(ROLE_PRESET_SELECTION_LIMIT).nullable(),
  advancedRules: z.array(advancedRuleSchema).max(ROLE_EDITABLE_RULE_LIMIT).nullable(),
  holders: z.strictObject({
    total: count,
    sample: z.array(roleHolderSampleSchema).max(ROLE_HOLDER_SAMPLE_LIMIT),
    truncated: z.boolean(),
  }),
  impact: z.strictObject({ liveInvitationCount: count }),
})
export type RoleDefinitionDetail = z.infer<typeof roleDefinitionDetailSchema>

const roleName = z.string().min(ROLE_NAME_MIN).max(ROLE_NAME_MAX)
const roleDescription = z.string().max(ROLE_DESCRIPTION_MAX)

/** Create trims; empty description becomes `null` in the service. */
export const createRoleDefinitionSchema = z.strictObject({
  name: z.string().trim().min(ROLE_NAME_MIN).max(ROLE_NAME_MAX),
  description: roleDescription.nullish(),
})
export type CreateRoleDefinition = z.infer<typeof createRoleDefinitionSchema>

/**
 * Save keeps the RAW submitted name/description through validation: under the lock a raw
 * value equal to the stored one is preserved verbatim (a preset-only save is not a rename).
 */
export const saveRoleDefinitionSchema = z
  .strictObject({
    expectedAclVersion: revision,
    name: roleName,
    description: roleDescription.nullable(),
    presets: z.array(roleDefinitionPresetSchema).max(ROLE_PRESET_SELECTION_LIMIT),
    acknowledgeFullControl: z.literal(true).optional(),
    acknowledgeSelfHeld: z.literal(true).optional(),
  })
  .refine(
    (body) =>
      new Set(body.presets.map((preset) => `${preset.capabilityId}:${preset.presetId}`)).size ===
      body.presets.length
  )
export type SaveRoleDefinition = z.infer<typeof saveRoleDefinitionSchema>

export const saveRoleDefinitionResponseSchema = z.strictObject({
  detail: roleDefinitionDetailSchema,
  changed: z.boolean(),
})
export type SaveRoleDefinitionResponse = z.infer<typeof saveRoleDefinitionResponseSchema>

export const deleteRoleDefinitionSchema = z.strictObject({
  expectedAclVersion: revision,
  expectedLiveInvitationCount: count,
  acknowledgeSelfHeld: z.literal(true).optional(),
})
export type DeleteRoleDefinition = z.infer<typeof deleteRoleDefinitionSchema>

export const deleteRoleDefinitionResponseSchema = z.strictObject({
  roleId: roleIdSchema,
  aclVersion: count,
  removedHolderCount: count,
  affectedInvitationCount: count,
})
export type DeleteRoleDefinitionResponse = z.infer<typeof deleteRoleDefinitionResponseSchema>

/** Reserved builtin names are matched case-insensitively on trimmed input. */
export function isReservedRoleName(name: string): boolean {
  const normalized = name.trim().toUpperCase()
  return (RESERVED_ROLE_NAMES as readonly string[]).includes(normalized)
}
