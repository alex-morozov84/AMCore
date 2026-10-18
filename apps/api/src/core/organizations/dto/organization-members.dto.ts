import {
  memberAccessSchema,
  memberRemovalQuerySchema,
  memberRolesQuerySchema,
  memberRolesResponseSchema,
  organizationMembersQuerySchema,
  organizationMembersResponseSchema,
  replaceMemberRolesResponseSchema,
  replaceMemberRolesSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class OrganizationMembersQueryDto extends createSchemaDto(organizationMembersQuerySchema) {}
export class MemberRolesQueryDto extends createSchemaDto(memberRolesQuerySchema) {}
export class OrganizationMembersResponseDto extends createSchemaDto(
  organizationMembersResponseSchema
) {}
export const MemberRolesResponseDto = createSchemaDto(
  memberRolesResponseSchema,
  'MemberRolesResponseDto'
)
export class MemberAccessResponseDto extends createSchemaDto(memberAccessSchema) {}
export class ReplaceMemberRolesDto extends createSchemaDto(replaceMemberRolesSchema) {}
export class ReplaceMemberRolesResponseDto extends createSchemaDto(
  replaceMemberRolesResponseSchema
) {}

export class MemberRemovalQueryDto extends createSchemaDto(memberRemovalQuerySchema) {}
