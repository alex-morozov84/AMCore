import { applyDecorators } from '@nestjs/common'
import { ApiResponse } from '@nestjs/swagger'
import { z } from 'zod'

import { aiRunArchivedSchema } from '@amcore/shared'

const archivedErrorSchema = z.object({
  statusCode: z.literal(410),
  message: z.string(),
  errorCode: z.literal('AI_RUN_ARCHIVED'),
  details: aiRunArchivedSchema,
  timestamp: z.iso.datetime(),
  path: z.string(),
  method: z.string(),
  correlationId: z.string().optional(),
})

/** Owner-scoped 410 contract; missing and foreign identities remain 404. */
export function ApiArchivedRunResponse(): ReturnType<typeof applyDecorators> {
  return applyDecorators(
    ApiResponse({
      status: 410,
      description: 'Owned archived AI run identity; returned before SSE headers when applicable.',
      standardSchema: archivedErrorSchema,
    })
  )
}
