import { z } from 'zod'

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
  email: z.email(),
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

/** Assign permission to role */
export const assignPermissionSchema = z.object({
  action: z.enum(['create', 'read', 'update', 'delete', 'manage']),
  subject: z.string().min(1).max(100),
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

/** Switch organization response */
export const switchOrgResponseSchema = z.object({
  accessToken: z.string(),
})

export type SwitchOrgResponse = z.infer<typeof switchOrgResponseSchema>
