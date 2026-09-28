import { createZodDto } from 'nestjs-zod'
import type { z } from 'zod'

import { type AssignPermissionInput, assignPermissionSchema } from '@amcore/shared'

// Flatten the union's common output keys for a class constructor; validation and
// OpenAPI still use the original subject-specific union at runtime.
type PermissionPayload = { [K in keyof AssignPermissionInput]: AssignPermissionInput[K] }
export class AssignPermissionDto extends createZodDto(
  assignPermissionSchema as z.ZodType<PermissionPayload>
) {}
