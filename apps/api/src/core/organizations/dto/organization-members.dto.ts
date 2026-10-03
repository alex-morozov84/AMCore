import { createZodDto } from 'nestjs-zod'

import {
  memberRolesQuerySchema,
  memberRolesResponseSchema,
  organizationMembersQuerySchema,
  organizationMembersResponseSchema,
  replaceMemberRolesResponseSchema,
  replaceMemberRolesSchema,
} from '@amcore/shared'

export class OrganizationMembersQueryDto extends createZodDto(organizationMembersQuerySchema) {}
export class MemberRolesQueryDto extends createZodDto(memberRolesQuerySchema) {}
export class OrganizationMembersResponseDto extends createZodDto(
  organizationMembersResponseSchema
) {}
export const MemberRolesResponseDto = createZodDto(memberRolesResponseSchema)
export class ReplaceMemberRolesDto extends createZodDto(replaceMemberRolesSchema) {}
export class ReplaceMemberRolesResponseDto extends createZodDto(replaceMemberRolesResponseSchema) {}
