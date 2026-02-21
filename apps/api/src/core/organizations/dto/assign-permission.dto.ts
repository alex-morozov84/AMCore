import { createZodDto } from 'nestjs-zod'

import { assignPermissionSchema } from '@amcore/shared'

export class AssignPermissionDto extends createZodDto(assignPermissionSchema) {}
