import { createZodDto } from 'nestjs-zod'

import {
  createRoleDefinitionSchema,
  deleteRoleDefinitionResponseSchema,
  deleteRoleDefinitionSchema,
  roleDefinitionDetailSchema,
  roleDefinitionListQuerySchema,
  roleDefinitionListResponseSchema,
  saveRoleDefinitionResponseSchema,
  saveRoleDefinitionSchema,
} from '@amcore/shared'

export class RoleDefinitionListQueryDto extends createZodDto(roleDefinitionListQuerySchema) {}
export class RoleDefinitionListResponseDto extends createZodDto(roleDefinitionListResponseSchema) {}
export class RoleDefinitionDetailDto extends createZodDto(roleDefinitionDetailSchema) {}
export class CreateRoleDefinitionDto extends createZodDto(createRoleDefinitionSchema) {}
export class SaveRoleDefinitionDto extends createZodDto(saveRoleDefinitionSchema) {}
export class SaveRoleDefinitionResponseDto extends createZodDto(saveRoleDefinitionResponseSchema) {}
export class DeleteRoleDefinitionDto extends createZodDto(deleteRoleDefinitionSchema) {}
export class DeleteRoleDefinitionResponseDto extends createZodDto(
  deleteRoleDefinitionResponseSchema
) {}
