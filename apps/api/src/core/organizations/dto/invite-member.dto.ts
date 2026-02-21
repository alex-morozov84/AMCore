import { createZodDto } from 'nestjs-zod'

import { inviteMemberSchema } from '@amcore/shared'

export class InviteMemberDto extends createZodDto(inviteMemberSchema) {}
