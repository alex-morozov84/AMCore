import {
  DEFAULT_LOCALE, invitationFlowAuthResponseSchema, invitationFlowContextResponseSchema,
  invitationFlowPendingResponseSchema, localizedFrontendUrl,
} from '@amcore/shared'
import { expect, request, test } from '@playwright/test'

import { TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { inviteRecipient, membershipCount } from '../real-stack/invitation-recipient.helpers'
import { activeTarget } from '../support/managed-target.mjs'

test('HTTPS: a genuinely issued pending handoff rejects ACK after another session is published', async ({ context }) => {
  const target = activeTarget()
  expect(target.origins.product).toMatch(/^https:/)
  const origin = target.origins.product
  const headers = { origin }
  const email = uniqueEmail('issued-ack')
  const invitation = await inviteRecipient(email)
  expect((await context.request.post(new URL('/api/auth/register', origin).href, {
    headers, data: { email, password: TEST_PASSWORD },
  })).status()).toBe(201)
  expect((await context.request.post(new URL('/api/auth/logout', origin).href, { headers })).ok()).toBe(true)
  // RequestContext follows the real bootstrap and stores cookies without executing
  // page scripts, so the UI cannot automatically confirm this issued handoff.
  const ingress = await context.request.get(localizedFrontendUrl(origin, DEFAULT_LOCALE,
    `invite/accept?token=${invitation.token}`))
  expect(ingress.ok()).toBe(true)
  const flowId = new URL(ingress.url()).pathname.split('/').at(-1)
  const root = `/api/invitation-flows/${flowId}`
  const current = await context.request.get(new URL(`${root}/context`, origin).href)
  expect(current.status()).toBe(200)
  const { binding } = invitationFlowContextResponseSchema.parse(await current.json())
  const login = await context.request.post(new URL(`${root}/login`, origin).href, {
    headers, data: { binding, email, password: TEST_PASSWORD },
  })
  expect(login.status()).toBe(200)
  const issued = invitationFlowAuthResponseSchema.parse(await login.json())
  const pending = await context.request.get(new URL(`${root}/context`, origin).href)
  expect(pending.status()).toBe(200)
  expect(invitationFlowPendingResponseSchema.parse(await pending.json())).toEqual({
    state: 'completing_signin', binding: issued.binding, handoff: issued.handoff,
  })
  const independent = await request.newContext({
    proxy: { server: target.relay }, ignoreHTTPSErrors: true,
  })
  try {
    const replacement = await independent.post(new URL('/api/auth/register', origin).href, {
      headers, data: { email: uniqueEmail('issued-ack-replacement'), password: TEST_PASSWORD },
    })
    expect(replacement.status()).toBe(201)
    const cookies = (await independent.storageState()).cookies.filter(c => c.name === 'amcore_session')
    expect(cookies).toHaveLength(1)
    await context.addCookies(cookies)
    const ack = await context.request.post(new URL(
      `${root}/auth-handoffs/${issued.handoff.attemptId}/ack`, origin).href, {
      headers, data: { binding: issued.binding },
    })
    expect(ack.status()).toBe(409)
    expect((await ack.json()).errorCode).toBe('INVITE_FLOW_CHANGED')
    expect(membershipCount(email, invitation.org.id)).toBe('0')
  } finally {
    await independent.dispose()
  }
})
