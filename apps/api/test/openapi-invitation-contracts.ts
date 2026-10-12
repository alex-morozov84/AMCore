import { expect } from '@jest/globals'
import type { OpenAPIObject } from '@nestjs/swagger'
import { z } from 'zod'

import {
  acceptInviteResponseSchema,
  acceptInviteSchema,
  invitationInspectResponseSchema,
  invitationOperationResponseSchema,
  managerInviteOperationResponseSchema,
  memberRolesResponseSchema,
  organizationMembersResponseSchema,
  reissueInviteSchema,
  replaceMemberRolesResponseSchema,
  replaceMemberRolesSchema,
} from '@amcore/shared'

const members = '/organizations/{orgId}/members'
const reissue = '/organizations/{orgId}/invites/{inviteId}/reissue'
const accept = '/auth/invites/accept'
const contracts: {
  path: string
  method: 'get' | 'post' | 'patch'
  status?: string
  name: string
  schema: z.ZodType
}[] = [
  { path: reissue, method: 'post', name: 'ReissueInviteDto', schema: reissueInviteSchema },
  { path: accept, method: 'post', name: 'AcceptInviteDto', schema: acceptInviteSchema },
  {
    path: accept,
    method: 'post',
    status: '200',
    name: 'AcceptInviteResponseDto',
    schema: acceptInviteResponseSchema,
  },
  {
    path: '/auth/invites/inspect',
    method: 'post',
    status: '200',
    name: 'InvitationInspectDto',
    schema: invitationInspectResponseSchema,
  },
  {
    path: '/auth/invites/continuations/inspect',
    method: 'post',
    status: '200',
    name: 'InvitationInspectDto',
    schema: invitationInspectResponseSchema,
  },
  {
    path: '/auth/invites/operations/{operationId}',
    method: 'get',
    status: '200',
    name: 'InvitationOperationDto',
    schema: invitationOperationResponseSchema,
  },
  {
    path: '/organizations/{orgId}/invite-operations/{operationId}',
    method: 'get',
    status: '200',
    name: 'ManagerInviteOperationResponseDto',
    schema: managerInviteOperationResponseSchema,
  },
  {
    path: `${members}/{userId}/roles`,
    method: 'get',
    status: '200',
    name: 'MemberRolesResponseDto',
    schema: memberRolesResponseSchema,
  },
  {
    path: members,
    method: 'get',
    status: '200',
    name: 'OrganizationMembersResponseDto',
    schema: organizationMembersResponseSchema,
  },
  {
    path: `${members}/{userId}/roles`,
    method: 'patch',
    name: 'ReplaceMemberRolesDto',
    schema: replaceMemberRolesSchema,
  },
  {
    path: `${members}/{userId}/roles`,
    method: 'patch',
    status: '200',
    name: 'ReplaceMemberRolesResponseDto',
    schema: replaceMemberRolesResponseSchema,
  },
]

export function assertInvitationSchemaContracts(document: OpenAPIObject): void {
  for (const contract of contracts) {
    const operation = document.paths[contract.path]![contract.method]!
    const body = contract.status ? operation.responses[contract.status] : operation.requestBody
    const component = contract.status ? `${contract.name}_Output` : contract.name
    expect(body).toMatchObject({
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${component}` } } },
    })
    expect(document.components!.schemas![component]).toEqual(
      z.toJSONSchema(contract.schema, {
        target: 'openapi-3.0',
        io: contract.status ? 'output' : 'input',
        unrepresentable: 'any',
      })
    )
  }
  expect(document.components!.schemas).not.toHaveProperty('Dto')
  expect(document.components!.schemas).not.toHaveProperty('Dto_Output')
}
