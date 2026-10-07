import { z } from 'zod'

import { Action, Subject } from '../enums/permissions'

export const capabilityIdSchema = z.enum([
  'teamAccess.manage',
  'organization.read',
  'organization.update',
  'organization.delete',
])
export const affordanceDecisionSchema = z.enum(['allowed', 'recordRequired', 'denied'])

export const actorAffordancesSchema = z.strictObject({
  'teamAccess.manage': affordanceDecisionSchema,
  'organization.read': affordanceDecisionSchema,
  'organization.update': affordanceDecisionSchema,
  'organization.delete': affordanceDecisionSchema,
})

export const recordActionSchema = z.strictObject({
  allowed: z.boolean(),
  fields: z.record(z.string(), z.boolean()),
})
export const organizationRecordAffordancesSchema = z.strictObject({
  'organization.read': recordActionSchema,
  'organization.update': recordActionSchema,
  'organization.delete': recordActionSchema,
})

/** Confirmation kinds the role editor understands; a descriptor may declare one of them. */
export const capabilityRiskSchema = z.enum(['fullControl'])

export const capabilityCatalogueResponseSchema = z.strictObject({
  capabilities: z.array(
    z.strictObject({
      id: capabilityIdSchema,
      risk: capabilityRiskSchema.optional(),
      subject: z.enum(Subject),
      action: z.enum(Action),
      operation: z.string(),
      method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
      path: z.string(),
      labelKey: z.string(),
      credentials: z.array(z.enum(['bearer', 'apiKey'])),
      presets: z.array(z.enum(['own', 'assigned', 'all'])),
      editableFields: z.array(z.string()),
    })
  ),
})
export const createPresetPermissionSchema = z.strictObject({
  capabilityId: capabilityIdSchema,
  presetId: z.enum(['own', 'assigned', 'all']),
})

export type ActorAffordances = z.infer<typeof actorAffordancesSchema>
export type OrganizationRecordAffordances = z.infer<typeof organizationRecordAffordancesSchema>
export type CapabilityCatalogueResponse = z.infer<typeof capabilityCatalogueResponseSchema>
export type CreatePresetPermissionInput = z.infer<typeof createPresetPermissionSchema>
