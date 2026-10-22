import { scheduledJobsResponseSchema, scheduledRunsResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class ScheduledJobsResponseDto extends createSchemaDto(scheduledJobsResponseSchema) {}
export class ScheduledRunsResponseDto extends createSchemaDto(scheduledRunsResponseSchema) {}
