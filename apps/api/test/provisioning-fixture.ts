import { ConfigService } from '@nestjs/config'
import request from 'supertest'

import { DEFAULT_LOCALE } from '@amcore/shared'
import { createInvitationOperationId } from '@amcore/shared'

import {
  InvitationEmailService,
  type InvitationMailSnapshot,
} from '../src/core/organizations/invitation-email.service'

import { cleanDatabase, cleanOrgData, type E2ETestContext } from './helpers'

export async function prepareProvisioningFixture(context: E2ETestContext) {
  const http = () => request(context.app.getHttpServer())
  await cleanOrgData(context.prisma)
  await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
  const config = context.app.get(ConfigService)
  config.set('NODE_ENV', 'test')
  config.set('EMAIL_PROVIDER', 'mock')
  config.set('AUTH_PUBLIC_SIGNUP_ENABLED', true)
  config.set('ORG_SELF_SERVICE_CREATION_ENABLED', false)
  const account = await http()
    .post('/auth/register')
    .send({ email: 'operator@e2e.amcore.test', password: 'StrongP@ss123' })
    .expect(201)
  await context.prisma.user.update({
    where: { id: account.body.user.id },
    data: { systemRole: 'SUPER_ADMIN' },
  })
  const login = await http()
    .post('/auth/login')
    .send({ email: 'operator@e2e.amcore.test', password: 'StrongP@ss123' })
    .expect(200)
  const token: string = login.body.accessToken
  const mail = new Map<string, InvitationMailSnapshot>()
  const spy = import.meta.jest
    .spyOn(context.app.get(InvitationEmailService), 'dispatch')
    .mockImplementation(async (snapshot) => {
      mail.set(snapshot.email, snapshot)
    })
  const input = (overrides: object = {}) => ({
    operationId: createInvitationOperationId(),
    name: 'North shop',
    slug: 'north-shop',
    firstAdminEmail: 'admin@e2e.amcore.test',
    inviteLocale: DEFAULT_LOCALE,
    ...overrides,
  })
  const create = (body = input()) =>
    http().post('/admin/organization-provisionings').auth(token, { type: 'bearer' }).send(body)
  const status = (orgId: string) =>
    http().get(`/admin/organizations/${orgId}/provisioning`).auth(token, { type: 'bearer' })
  const recover = (orgId: string, action: string, body: object) =>
    http()
      .post(`/admin/organizations/${orgId}/provisioning/${action}`)
      .auth(token, { type: 'bearer' })
      .send(body)
  return {
    http,
    token,
    operatorId: account.body.user.id as string,
    input,
    create,
    status,
    recover,
    mail,
    restore: () => spy.mockRestore(),
  }
}

export async function prepareProvisioningRecipient(
  context: E2ETestContext,
  fixture: Awaited<ReturnType<typeof prepareProvisioningFixture>>
) {
  context.app.get(ConfigService).set('AUTH_PUBLIC_SIGNUP_ENABLED', false)
  const issued = fixture.mail.get('admin@e2e.amcore.test')!
  const admitted = await fixture
    .http()
    .post('/auth/invites/continuations')
    .send({ token: issued.token })
    .expect(201)
  const registered = await fixture
    .http()
    .post('/auth/invites/register')
    .set('X-Invitation-Continuation', admitted.body.credential)
    .send({ password: 'StrongP@ss123' })
    .expect(201)
  const id: string = registered.body.user.id
  const token: string = registered.body.accessToken
  expect(await context.prisma.orgMember.count({ where: { userId: id } })).toBe(0)
  const inspect = () =>
    fixture
      .http()
      .post('/auth/invites/inspect')
      .auth(token, { type: 'bearer' })
      .send({ token: issued.token })
  expect((await inspect().expect(200)).body.state).toBe('verify_email')
  // Controlled verified fixture. Actual email verification belongs to the separate rendered-mail browser lane.
  await context.prisma.user.update({ where: { id }, data: { emailVerified: true } })
  const accept = () =>
    fixture
      .http()
      .post('/auth/invites/accept')
      .auth(token, { type: 'bearer' })
      .set('X-Invitation-Operation-Id', createInvitationOperationId())
      .send({ token: issued.token, ...admitted.body.intent })
  return { id, token, inspect, accept, inviteId: admitted.body.intent.expectedInviteId as string }
}
