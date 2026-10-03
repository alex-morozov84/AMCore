import { JwtService } from '@nestjs/jwt'
import request from 'supertest'

import type { InviteService } from '../../src/core/organizations/invite.service'

import { boundedFailure, trackInvitationOperation } from './invitation-operation'
import type { InvitationProofFixture } from './invitation-proof'
import { deferred } from './organization-members-race'
const jest = import.meta.jest

/** Pause only after actual auth/context/policy guards delivered their actor. */
export async function afterInvitationAdmission(
  invites: InviteService,
  method: 'createInvite' | 'revokeInvite',
  send: () => Promise<request.Response>,
  mutate: () => Promise<void>,
  resumed?: (operation: Promise<unknown>) => Promise<void>
): Promise<request.Response> {
  const entered = deferred()
  const release = deferred()
  const original = invites[method].bind(invites)
  let captured = false
  let started: Promise<unknown> | undefined
  const spy = jest.spyOn(invites, method).mockImplementation((async (...args: unknown[]) => {
    if (!captured) {
      captured = true
      entered.resolve()
      await Promise.race([release.promise, boundedFailure('HTTP admission release')])
    }
    const operation = trackInvitationOperation(() =>
      (original as (...values: unknown[]) => Promise<unknown>)(...args)
    )
    started = operation
    void operation.catch(() => undefined)
    if (resumed) await resumed(operation)
    return operation
  }) as never)
  const response = send()
  try {
    await Promise.race([
      entered.promise,
      response.then(() => {
        throw new Error('HTTP request completed before invitation admission')
      }),
      boundedFailure('HTTP invitation admission'),
    ])
    await mutate()
    release.resolve()
    return await response
  } finally {
    release.resolve()
    await response.catch(() => undefined)
    if (started) await Promise.allSettled([started])
    spy.mockRestore()
  }
}

export async function invitationJwt(fixture: InvitationProofFixture): Promise<string> {
  const { context, prisma, owner, orgId } = fixture
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
  return context.app.get(JwtService).sign({ ...owner, aclVersion: org.aclVersion })
}

export function invitationHttp(
  fixture: InvitationProofFixture,
  credential: string,
  operation: 'create' | 'revoke',
  inviteId: string
): Promise<request.Response> {
  const { context, orgId, recipient } = fixture
  const server = context.app.getHttpServer()
  return operation === 'create'
    ? request(server)
        .post(`/organizations/${orgId}/members/invite`)
        .auth(credential, { type: 'bearer' })
        .timeout({ response: 5000, deadline: 6000 })
        .send({ email: recipient.email })
        .then((r) => r)
    : request(server)
        .delete(`/organizations/${orgId}/invites/${inviteId}`)
        .auth(credential, { type: 'bearer' })
        .timeout({ response: 5000, deadline: 6000 })
        .then((r) => r)
}
