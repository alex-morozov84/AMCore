import type { z } from 'zod'
import type * as schemas from '../schemas/organization-administration'

export type AdministratorInvitationCreate = z.infer<
  typeof schemas.administratorInvitationCreateSchema
>
export type AdministratorInvitationReissue = z.infer<
  typeof schemas.administratorInvitationReissueSchema
>
export type AdministratorInvitationReplace = z.infer<
  typeof schemas.administratorInvitationReplaceSchema
>
export type AdministratorInvitationCancel = z.infer<
  typeof schemas.administratorInvitationCancelSchema
>
export type AdministratorAssignment = z.infer<typeof schemas.administratorAssignmentSchema>
export type AdministratorCommandReceipt = z.infer<typeof schemas.administratorCommandReceiptSchema>
export type AdministratorAssignmentReceipt = z.infer<
  typeof schemas.administratorAssignmentReceiptSchema
>
export type AdministratorInvitationProgress = z.infer<
  typeof schemas.administratorInvitationProgressSchema
>
export type AdministratorAttentionQuery = z.infer<typeof schemas.administratorAttentionQuerySchema>
export type AdministratorSummaryQuery = z.infer<typeof schemas.administratorSummaryQuerySchema>
export type AdministratorAttention = z.infer<typeof schemas.administratorAttentionSchema>
export type AdministratorSummary = z.infer<typeof schemas.administratorSummarySchema>

export type AdministratorOperation = z.infer<typeof schemas.administratorOperationSchema>
