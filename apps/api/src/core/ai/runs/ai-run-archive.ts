import { HttpStatus } from '@nestjs/common'

import { aiRunArchivedSchema, ResourceErrorCode } from '@amcore/shared'

import { AppException } from '@/common/exceptions'
import type { AiRunTombstone } from '@/generated/prisma/client'

export function archivedRunError(row: AiRunTombstone): AppException {
  const details = aiRunArchivedSchema.parse({
    id: row.id,
    conversationId: row.conversationId,
    terminalStatus: row.terminalStatus.toLowerCase(),
    finishedAt: row.finishedAt.toISOString(),
    archivedAt: row.archivedAt.toISOString(),
  })
  return new AppException(
    'This AI run was archived.',
    HttpStatus.GONE,
    ResourceErrorCode.AI_RUN_ARCHIVED,
    details
  )
}
