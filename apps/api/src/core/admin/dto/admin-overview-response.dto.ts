import { createZodDto } from 'nestjs-zod'

import { adminOverviewResponseSchema } from '@amcore/shared'

/** Console Overview status response DTO — see `adminOverviewResponseSchema` for the contract. */
export class AdminOverviewResponseDto extends createZodDto(adminOverviewResponseSchema) {}
