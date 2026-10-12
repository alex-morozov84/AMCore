import { apiKeyQuerySchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'
export class ApiKeyQueryDto extends createSchemaDto(apiKeyQuerySchema) {}
