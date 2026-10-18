import {
  memberKeyCommandSchema,
  memberKeyListSchema,
  memberKeyQuerySchema,
  memberKeyResultSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'
export class MemberKeyQueryDto extends createSchemaDto(memberKeyQuerySchema) {}
export class MemberKeyCommandDto extends createSchemaDto(memberKeyCommandSchema) {}
export class MemberKeyListDto extends createSchemaDto(memberKeyListSchema) {}
export class MemberKeyResultDto extends createSchemaDto(memberKeyResultSchema) {}
