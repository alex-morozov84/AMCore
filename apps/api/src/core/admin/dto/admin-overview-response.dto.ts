import { adminOverviewResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

/** Console Overview status response DTO — see `adminOverviewResponseSchema` for the contract. */
export class AdminOverviewResponseDto extends createSchemaDto(adminOverviewResponseSchema) {}
