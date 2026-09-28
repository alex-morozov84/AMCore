import { z } from 'zod'

import { Action, Subject } from '../enums/permissions'

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

/** Explicit model grants; TeamAccess is unrestricted full administration. */
const permissionActionSchema = z.enum(Action)
const permissionFieldsSchema = z.array(z.string())
const modelPermissionSchema = z.object({
  action: permissionActionSchema,
  subject: z.enum([Subject.User, Subject.Organization, Subject.Role, Subject.Permission]),
  conditions: z.record(z.string(), z.unknown()).nullable().optional(),
  fields: permissionFieldsSchema.optional(),
  inverted: z.boolean().optional().default(false),
})

export const assignPermissionSchema = z.union([
  modelPermissionSchema,
  z.object({
    action: z.literal(Action.Manage),
    subject: z.literal(Subject.TeamAccess),
    conditions: z.strictObject({}).nullable().optional(),
    fields: z.union([z.tuple([]), z.tuple([z.literal('*')])]).optional(),
    inverted: z.boolean().optional().default(false),
  }),
  z.object({
    action: permissionActionSchema,
    subject: z.literal(Subject.All),
    conditions: z.record(z.string(), z.unknown()).nullable().optional(),
    fields: permissionFieldsSchema.optional(),
    inverted: z.literal(true),
  }),
])

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
