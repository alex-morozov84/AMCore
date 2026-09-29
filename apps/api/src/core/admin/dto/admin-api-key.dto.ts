import { createZodDto } from 'nestjs-zod'

import {
  adminApiKeyListResponseSchema,
  adminApiKeyQuerySchema,
  adminApiKeyRevokeResponseSchema,
  adminApiKeyRevokeSchema,
} from '@amcore/shared'

export class AdminApiKeyQueryDto extends createZodDto(adminApiKeyQuerySchema) {}
export class AdminApiKeyListDto extends createZodDto(adminApiKeyListResponseSchema) {}
export class AdminApiKeyRevokeDto extends createZodDto(adminApiKeyRevokeSchema) {}
export class AdminApiKeyRevokeResultDto extends createZodDto(adminApiKeyRevokeResponseSchema) {}
