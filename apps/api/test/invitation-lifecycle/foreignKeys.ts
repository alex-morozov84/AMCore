import { type RequestPrincipal } from '@amcore/shared'

import { registerApiKeyAdmission } from '../../src/core/api-keys/api-key-admission'
import { ApiKeysService } from '../../src/core/api-keys/api-keys.service'
import { invitationActor } from '../../src/core/organizations/invitation-actor'
import { RoleService } from '../../src/core/organizations/role.service'
import { EmailService } from '../../src/infrastructure/email/email.service'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
import { invitationFence, observeInvitationWait } from '../helpers/invitation-race'
const jest = import.meta.jest

export function registerForeignKeysProofs(getFixture: () => InvitationProofFixture): void {
  it('R07 organization delete waits committed acceptance then cascades', async () => {
    const { prisma, pool, orgId, pending, accept, outcome, claim } = getFixture()
    const { token } = await pending()
    const fence = claim()
    const accepting = outcome(accept(token))
    let deleting: Promise<unknown> | undefined
    try {
      await fence.entered
      deleting = pool.query('DELETE FROM core.organizations WHERE id=$1', [orgId])
      await observeInvitationWait(pool, fence.pid(), 'DELETE FROM core.organizations')
      fence.release()
      expect(await accepting).toBe(200)
      await deleting
      expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(0)
      expect(await prisma.orgMember.count({ where: { organizationId: orgId } })).toBe(0)
    } finally {
      fence.restore()
      await Promise.allSettled([accepting, ...(deleting ? [deleting] : [])])
    }
  })

  it.each([true, false])(
    'R06 supported role deletion versus accept, acceptance first=%s',
    async (acceptFirst) => {
      const { context, prisma, orgId, owner, pending, accept, claim, truth, race } = getFixture()
      const role = await prisma.role.create({
        data: { name: 'Supported deletion', organizationId: orgId },
      })
      const { token, invite } = await pending(role.id)
      const baseline = (await truth(invite.id)).org!.aclVersion
      const deletion = (): Promise<void> =>
        context.app.get(RoleService).deleteRole(orgId, role.id, owner)
      const deletingFence = (): ReturnType<typeof invitationFence> =>
        invitationFence(prisma, (model, method) => model === 'role' && method === 'delete')
      expect(
        await race(
          acceptFirst ? claim() : deletingFence(),
          acceptFirst ? () => accept(token) : deletion,
          acceptFirst ? deletion : () => accept(token)
        )
      ).toEqual([200, acceptFirst ? 200 : 400])
      const after = await truth(invite.id)
      expect(after.members).toHaveLength(acceptFirst ? 1 : 0)
      expect(after.org!.aclVersion).toBe(baseline + (acceptFirst ? 2 : 1))
      expect(await prisma.memberRole.count({ where: { roleId: role.id } })).toBe(0)
    }
  )

  it('R07 organization deletion first blocks acceptance and removes all descendants', async () => {
    const { prisma, pool, orgId, pending, accept, outcome } = getFixture()
    const { token } = await pending()
    const client = await pool.connect()
    await client.query('BEGIN')
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await client.query('DELETE FROM core.organizations WHERE id=$1', [orgId])
    const accepting = outcome(accept(token))
    try {
      await observeInvitationWait(pool, pid, 'core.organizations')
      await client.query('COMMIT')
      expect(await accepting).toBe(400)
      expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(0)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await accepting
    }
  })

  it.each([true, false])(
    'R07 key-backed issuance/org cascade, issuance first=%s',
    async (createFirst) => {
      const { context, prisma, pool, invites, orgId, owner, recipient, outcome } = getFixture()
      const key = await context.app.get(ApiKeysService).create(owner.sub, {
        name: 'Cascade',
        organizationId: orgId,
        scopes: ['manage:TeamAccess'],
      })
      const principal: RequestPrincipal = {
        ...owner,
        type: 'api_key',
        scopes: ['manage:TeamAccess'],
      }
      const request = {
        user: principal,
        privilegedAdmission: { authenticated: principal, principal },
      }
      registerApiKeyAdmission(request, key.id, principal)
      const admitted = invitationActor(request)
      const mail = jest
        .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
        .mockResolvedValue(undefined)
      const client = await pool.connect()
      let creating: Promise<number> | undefined
      let deleting: Promise<unknown> | undefined
      const fence = createFirst
        ? invitationFence(prisma, (model, method) => model === 'orgInvite' && method === 'create')
        : undefined
      let status = 0
      try {
        if (createFirst) {
          creating = outcome(invites.createInvite(orgId, { email: recipient.email! }, admitted))
          await fence!.entered
          deleting = client.query('DELETE FROM core.organizations WHERE id=$1', [orgId])
          await observeInvitationWait(pool, fence!.pid(), 'DELETE FROM core.organizations')
          fence!.release()
          status = await creating
          await deleting
        } else {
          await client.query('BEGIN')
          const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
          await client.query('DELETE FROM core.organizations WHERE id=$1', [orgId])
          creating = outcome(invites.createInvite(orgId, { email: recipient.email! }, admitted))
          await observeInvitationWait(pool, pid, 'core.organizations')
          await client.query('COMMIT')
          status = await creating
        }
        expect(status).toBe(createFirst ? 200 : 404)
        expect(await prisma.apiKey.count({ where: { id: key.id } })).toBe(0)
        expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(0)
      } finally {
        fence?.restore()
        await client.query('ROLLBACK')
        client.release()
        mail.mockRestore()
        await Promise.allSettled([...(creating ? [creating] : []), ...(deleting ? [deleting] : [])])
      }
    }
  )

  it('R06 deleted/null role is unusable and never becomes MEMBER', async () => {
    const { prisma, orgId, pending, accept, outcome, truth } = getFixture()
    const role = await prisma.role.create({ data: { name: 'Disposable', organizationId: orgId } })
    const { token, invite } = await pending(role.id)
    await prisma.role.delete({ where: { id: role.id } })
    expect(await outcome(accept(token))).toBe(400)
    const after = await truth(invite.id)
    expect(after.invite!.roleId).toBeNull()
    expect(after.invite!.acceptedAt).toBeNull()
    expect(after.members).toEqual([])
  })

  it('R06 direct single-role DELETE waits role SHARE, without FK deadlock', async () => {
    const { prisma, pool, orgId, pending, accept, outcome, claim } = getFixture()
    const role = await prisma.role.create({ data: { name: 'FK probe', organizationId: orgId } })
    const { token } = await pending(role.id)
    const fence = claim()
    const accepting = outcome(accept(token))
    const client = await pool.connect()
    let deletion: Promise<unknown> | undefined
    try {
      await fence.entered
      deletion = client.query('DELETE FROM core.roles WHERE id=$1', [role.id])
      await observeInvitationWait(pool, fence.pid(), 'DELETE FROM core.roles')
      fence.release()
      expect(await accepting).toBe(200)
      await deletion
      expect(await prisma.memberRole.count({ where: { roleId: role.id } })).toBe(0)
    } finally {
      fence.restore()
      await Promise.allSettled([accepting, ...(deletion ? [deletion] : [])])
      client.release()
    }
  })
}
