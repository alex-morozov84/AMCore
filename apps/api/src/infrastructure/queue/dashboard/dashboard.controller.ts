import { Controller, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { JwtAuthGuard } from '@/core/auth'

/**
 * Bull Board Dashboard Controller
 *
 * This controller serves as a placeholder for Bull Board router.
 * The actual Bull Board UI is mounted in QueueModule.
 *
 * Access: http://localhost:3001/admin/queues
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/queues')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  // Bull Board UI is mounted via middleware in QueueModule
  // This controller is just for Swagger documentation
}
