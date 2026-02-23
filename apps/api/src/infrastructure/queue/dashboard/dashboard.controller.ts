import { Controller } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { SystemRole } from '@amcore/shared'

import { SystemRoles } from '@/core/auth/decorators/system-roles.decorator'

/**
 * Bull Board Dashboard Controller
 *
 * This controller serves as a placeholder for Bull Board router.
 * The actual Bull Board UI is mounted in QueueModule.
 *
 * Access: http://localhost:3001/admin/queues (SUPER_ADMIN only)
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/queues')
@SystemRoles(SystemRole.SuperAdmin)
export class DashboardController {
  // Bull Board UI is mounted via middleware in QueueModule
  // This controller is just for Swagger documentation
}
