import {
  administratorAssignmentReceiptSchema,
  administratorAssignmentSchema,
  administratorAttentionQuerySchema,
  administratorAttentionSchema,
  administratorCommandReceiptSchema,
  administratorInvitationCancelSchema,
  administratorInvitationCreateSchema,
  administratorInvitationProgressSchema,
  administratorInvitationReissueSchema,
  administratorInvitationReplaceSchema,
  administratorOperationSchema,
  administratorSummaryQuerySchema,
  administratorSummarySchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class AdministratorInvitationCreateDto extends createSchemaDto(
  administratorInvitationCreateSchema
) {}
export class AdministratorInvitationReissueDto extends createSchemaDto(
  administratorInvitationReissueSchema
) {}
export class AdministratorInvitationReplaceDto extends createSchemaDto(
  administratorInvitationReplaceSchema
) {}
export class AdministratorInvitationCancelDto extends createSchemaDto(
  administratorInvitationCancelSchema
) {}
export class AdministratorAssignmentDto extends createSchemaDto(administratorAssignmentSchema) {}
export class AdministratorCommandReceiptDto extends createSchemaDto(
  administratorCommandReceiptSchema
) {}
export class AdministratorAssignmentReceiptDto extends createSchemaDto(
  administratorAssignmentReceiptSchema
) {}
export class AdministratorInvitationProgressDto extends createSchemaDto(
  administratorInvitationProgressSchema
) {}
export class AdministratorAttentionQueryDto extends createSchemaDto(
  administratorAttentionQuerySchema
) {}
export class AdministratorSummaryQueryDto extends createSchemaDto(
  administratorSummaryQuerySchema
) {}
export class AdministratorAttentionDto extends createSchemaDto(administratorAttentionSchema) {}
export class AdministratorSummaryDto extends createSchemaDto(administratorSummarySchema) {}
export const AdministratorOperationDto = createSchemaDto(
  administratorOperationSchema,
  'AdministratorOperationDto'
)
