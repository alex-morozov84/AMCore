import { createZodDto } from 'nestjs-zod'

import { acceptInviteSchema } from '@amcore/shared'

export class AcceptInviteDto extends createZodDto(acceptInviteSchema) {}
