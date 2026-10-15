import { createApiKeySchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class CreateApiKeyDto extends createSchemaDto(createApiKeySchema) {}
