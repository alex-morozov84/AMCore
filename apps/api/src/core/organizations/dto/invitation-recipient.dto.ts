import { createZodDto } from 'nestjs-zod'

import {
  invitationAdmissionResponseSchema,
  invitationAdmissionSchema,
  invitationContextSchema,
  invitationInspectResponseSchema,
  invitationOperationResponseSchema,
  invitedRegisterSchema,
} from '@amcore/shared'

export class InvitationAdmissionDto extends createZodDto(invitationAdmissionSchema) {}
export class InvitationAdmissionResponseDto extends createZodDto(
  invitationAdmissionResponseSchema
) {}
export class InvitationContextDto extends createZodDto(invitationContextSchema) {}
export const InvitationInspectDto = createZodDto(invitationInspectResponseSchema)
export const InvitationOperationDto = createZodDto(invitationOperationResponseSchema)
export class InvitedRegisterDto extends createZodDto(invitedRegisterSchema) {}
