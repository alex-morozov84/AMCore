import { createZodDto } from 'nestjs-zod'

import { acceptInviteSchema } from '@amcore/shared'

export const AcceptInviteDto = createZodDto(acceptInviteSchema)
