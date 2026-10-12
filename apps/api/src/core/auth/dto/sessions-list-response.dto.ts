import { sessionsListResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

/**
 * Paginated `GET /auth/sessions` response DTO (ADR-036 / OB-05).
 *
 * Replaces the legacy `{ sessions: Session[] }` shape. Wire is now
 * `{ data, total, page, limit }` like every other list endpoint.
 */
export class SessionsListResponseDto extends createSchemaDto(sessionsListResponseSchema) {}
