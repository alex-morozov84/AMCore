import {
  adminApiKeyListResponseSchema,
  adminApiKeyQuerySchema,
  adminApiKeyRevokeResponseSchema,
  adminApiKeyRevokeSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class AdminApiKeyQueryDto extends createSchemaDto(adminApiKeyQuerySchema) {}
export class AdminApiKeyListDto extends createSchemaDto(adminApiKeyListResponseSchema) {}
export class AdminApiKeyRevokeDto extends createSchemaDto(adminApiKeyRevokeSchema) {}
export class AdminApiKeyRevokeResultDto extends createSchemaDto(adminApiKeyRevokeResponseSchema) {}
