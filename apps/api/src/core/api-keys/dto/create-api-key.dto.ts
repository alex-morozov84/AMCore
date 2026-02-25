import { createZodDto } from 'nestjs-zod'

import { createApiKeySchema } from '@amcore/shared'

export class CreateApiKeyDto extends createZodDto(createApiKeySchema) {}
