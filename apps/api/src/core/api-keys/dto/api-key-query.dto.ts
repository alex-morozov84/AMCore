import { createZodDto } from 'nestjs-zod'

import { apiKeyQuerySchema } from '@amcore/shared'
export class ApiKeyQueryDto extends createZodDto(apiKeyQuerySchema) {}
