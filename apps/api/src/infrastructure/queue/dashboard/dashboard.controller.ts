import { Controller } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { SystemRole } from '@amcore/shared'

import { SystemRoles } from '@/core/auth/decorators/system-roles.decorator'

/**
 * Bull Board Dashboard Controller
 *
 * Swagger-only placeholder so the dashboard route appears in the OpenAPI doc.
 * It does NOT enforce access: the real Bull Board UI is mounted as Express
 * middleware in `QueueModule` (`BullBoardModule.forRootAsync`), so this
 * controller's `@SystemRoles` guard never runs for the UI's requests.
 *
 * Real enforcement (EQS-01):
 * - **Mount gate** — the controller and the router are only registered when
 *   `ENABLE_BULL_BOARD=true` (or any non-production env); in production they
 *   are absent by default.
 * - **Auth** — `createBullBoardAuthMiddleware` runs before the router: it
 *   rejects API-key / `x-api-key` machine credentials and requires a valid
 *   `refresh_token` cookie belonging to a `SUPER_ADMIN` user.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/queues')
@SystemRoles(SystemRole.SuperAdmin)
export class DashboardController {
  // Bull Board UI is mounted via middleware in QueueModule
  // This controller is just for Swagger documentation
}
