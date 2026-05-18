import { z } from 'zod'

import { Action, Subject } from '../enums/permissions'

import { emailInputSchema } from './auth'
import { paginatedResponseSchema } from './pagination'

// ===========================================
// Request Schemas
// ===========================================

/** Create organization */
export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
})

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>

/** Update organization */
export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
})

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>

/** Invite member by email */
export const inviteMemberSchema = z.object({
  email: emailInputSchema,
  roleId: z.string().optional(), // defaults to system MEMBER role if omitted
})

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

/** Create custom role */
export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(255).optional(),
})

export type CreateRoleInput = z.infer<typeof createRoleSchema>

/** Update custom role */
export const updateRoleSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(255).optional(),
})

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>

/**
 * Assign permission to role.
 *
 * OB-01: `action` and `subject` are both validated against the shared
 * `Action` and `Subject` enums in `packages/shared/src/enums/permissions.ts`.
 * Previously `subject` was a free-form string capped at 100 chars,
 * contradicting the closed-registry contract documented for fork
 * authors and letting typos (`'Contac'`, `'usr'`) create dead
 * permissions that no controller policy would ever consult. Forks
 * extend the registry by editing `Subject` (and `Action` for
 * symmetry); the schema now actually enforces what those enums
 * advertise.
 *
 * `Subject.All` remains valid: the seed uses `read:all`, `create:all`
 * for the system MEMBER role, and `manage:all` is the SUPER_ADMIN
 * wildcard. The API-key scope rule that forbids `manage:all` is a
 * credential-equivalence concern (AK-05), not applicable to DB role
 * permissions.
 */
export const assignPermissionSchema = z.object({
  action: z.enum([Action.Create, Action.Read, Action.Update, Action.Delete, Action.Manage]),
  subject: z.enum([
    Subject.User,
    Subject.Organization,
    Subject.Role,
    Subject.Permission,
    Subject.All,
  ]),
  conditions: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
  inverted: z.boolean().optional().default(false),
})

export type AssignPermissionInput = z.infer<typeof assignPermissionSchema>

// ===========================================
// Response Schemas
// ===========================================

/** Organization response */
export const orgResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  aclVersion: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type OrgResponse = z.infer<typeof orgResponseSchema>

/** Paginated organization list (ADR-036 / OB-05). */
export const organizationListResponseSchema = paginatedResponseSchema(orgResponseSchema)

export type OrganizationListResponse = z.infer<typeof organizationListResponseSchema>

/** Permission response */
export const permissionResponseSchema = z.object({
  id: z.string(),
  action: z.string(),
  subject: z.string(),
  conditions: z.unknown().nullable(),
  fields: z.array(z.string()),
  inverted: z.boolean(),
  organizationId: z.string().nullable(),
})

export type PermissionResponse = z.infer<typeof permissionResponseSchema>

/** Role response (with permissions) */
export const orgRoleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  organizationId: z.string().nullable(),
  permissions: z.array(permissionResponseSchema),
})

export type OrgRoleResponse = z.infer<typeof orgRoleResponseSchema>

/** Paginated role list (ADR-036 / OB-05). */
export const roleListResponseSchema = paginatedResponseSchema(orgRoleResponseSchema)

export type RoleListResponse = z.infer<typeof roleListResponseSchema>

/** Switch organization response */
export const switchOrgResponseSchema = z.object({
  accessToken: z.string(),
})

export type SwitchOrgResponse = z.infer<typeof switchOrgResponseSchema>
