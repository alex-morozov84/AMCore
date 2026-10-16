import type { z } from 'zod'

import { type AssignPermissionInput, assignPermissionSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

// Flatten the union's common output keys for a class constructor; validation and
// OpenAPI still use the original subject-specific union at runtime.
type PermissionPayload = { [K in keyof AssignPermissionInput]: AssignPermissionInput[K] }
export class AssignPermissionDto extends createSchemaDto(
  assignPermissionSchema as z.ZodType<PermissionPayload>
) {}
