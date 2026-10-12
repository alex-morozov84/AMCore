import { createApiKeySchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class CreateApiKeyDto extends createSchemaDto(createApiKeySchema) {}
