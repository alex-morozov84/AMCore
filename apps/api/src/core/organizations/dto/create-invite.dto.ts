import { createZodDto } from 'nestjs-zod'

import { createInviteSchema } from '@amcore/shared'

export class CreateInviteDto extends createZodDto(createInviteSchema) {}
