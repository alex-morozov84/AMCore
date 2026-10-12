import {
  invitationAdmissionResponseSchema,
  invitationAdmissionSchema,
  invitationContextSchema,
  invitationInspectResponseSchema,
  invitationOperationResponseSchema,
  invitedRegisterSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class InvitationAdmissionDto extends createSchemaDto(invitationAdmissionSchema) {}
export class InvitationAdmissionResponseDto extends createSchemaDto(
  invitationAdmissionResponseSchema
) {}
export class InvitationContextDto extends createSchemaDto(invitationContextSchema) {}
export const InvitationInspectDto = createSchemaDto(invitationInspectResponseSchema)
export const InvitationOperationDto = createSchemaDto(invitationOperationResponseSchema)
export class InvitedRegisterDto extends createSchemaDto(invitedRegisterSchema) {}
