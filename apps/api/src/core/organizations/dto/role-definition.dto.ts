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

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class RoleDefinitionListQueryDto extends createSchemaDto(roleDefinitionListQuerySchema) {}
export class RoleDefinitionListResponseDto extends createSchemaDto(
  roleDefinitionListResponseSchema
) {}
export class RoleDefinitionDetailDto extends createSchemaDto(roleDefinitionDetailSchema) {}
export class CreateRoleDefinitionDto extends createSchemaDto(createRoleDefinitionSchema) {}
export class SaveRoleDefinitionDto extends createSchemaDto(saveRoleDefinitionSchema) {}
export class SaveRoleDefinitionResponseDto extends createSchemaDto(
  saveRoleDefinitionResponseSchema
) {}
export class DeleteRoleDefinitionDto extends createSchemaDto(deleteRoleDefinitionSchema) {}
export class DeleteRoleDefinitionResponseDto extends createSchemaDto(
  deleteRoleDefinitionResponseSchema
) {}
