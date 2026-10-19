import { ownKeyQuerySchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'
export class ApiKeyQueryDto extends createSchemaDto(ownKeyQuerySchema) {}
