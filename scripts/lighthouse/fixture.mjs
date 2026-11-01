import { randomUUID } from 'node:crypto'
import { registerViaUi, loginViaUi, TEST_PASSWORD } from '../../apps/web/e2e/real-stack/helpers.ts'
import { guardedSql } from '../../apps/web/e2e/support/managed-target.mjs'
import { invariant, scenarioUrl } from '../lib/lighthouse-plan.mjs'

/** Credentials stay in this process and never enter its result file or console. */
export async function prepareFixture(context, m, scenario, alias) {
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  if (scenario.id === 'login')
    return { page, fixture: { secrets: [] }, url: scenarioUrl(scenario, m) }
  const email = `audit-${randomUUID()}@e2e.amcore.test`
  await registerViaUi(page, email)
  const subject = guardedSql('SELECT id FROM core.users WHERE "emailCanonical" = :\'email\';', {
    email,
  }).trim()
  invariant(/^[a-zA-Z0-9_-]{10,80}$/.test(subject), 'fixture-subject-unproved')
  let organization
  if (scenario.id === 'members') {
    const api = `http://127.0.0.1:${m.ports.api}/api/v1`
    const response = await context.request.post(`${api}/auth/login`, {
      data: { email, password: TEST_PASSWORD },
    })
    invariant(response.status() === 200, 'fixture-api-login-refused')
    const login = await response.json()
    invariant(login.user.id === subject, 'fixture-api-subject-mismatch')
    try {
      const created = await context.request.post(`${api}/organizations`, {
        headers: { authorization: `Bearer ${login.accessToken}` },
        data: { name: `Audit organization ${randomUUID()}` },
      })
      invariant(created.status() === 201, 'fixture-organization-refused')
      organization = await created.json()
    } finally {
      // This real API cookie jar can revoke its temporary refresh session; 204 has no JSON.
      const logout = await context.request.post(`${api}/auth/logout`, { data: {} })
      invariant(logout.status() === 204, 'fixture-api-logout-refused')
    }
    invariant(typeof organization.id === 'string', 'fixture-organization-missing')
  }
  let otherSubject
  if (process.env.AMCORE_AUDIT_ACCEPTANCE === 'true' && scenario.id === 'members') {
    const otherEmail = `audit-other-${randomUUID()}@e2e.amcore.test`
    const api = `http://127.0.0.1:${m.ports.api}/api/v1`
    const response = await context.request.post(`${api}/auth/register`, {
      data: { email: otherEmail, password: TEST_PASSWORD },
    })
    invariant(response.status() === 201, 'negative-subject-registration-refused')
    const other = await response.json()
    const logout = await context.request.post(`${api}/auth/logout`, { data: {} })
    invariant(logout.status() === 204, 'negative-subject-logout-refused')
    otherSubject = guardedSql(`SELECT id FROM core.users WHERE "emailCanonical" = :'email';`, {
      email: otherEmail,
    }).trim()
    invariant(
      otherSubject === other.user.id && otherSubject !== subject,
      'negative-subject-unproved'
    )
  }
  if (scenario.scope === 'console') {
    const { setSystemRole } = await import('../../apps/web/e2e/real-stack/admin-helpers.ts')
    setSystemRole(email, 'SUPER_ADMIN')
  }
  const fixture = {
    subject,
    otherSubject,
    email,
    organizationName: organization?.name,
    secrets: [TEST_PASSWORD],
  }
  if (scenario.scope === 'console') {
    fixture.consoleHost = m.consoleTopology === 'host'
    fixture.accessPath = fixture.consoleHost ? '/api/access' : '/api/console/access'
  }
  const url = scenarioUrl(scenario, m, { alias, id: organization?.id })
  // Fresh audience context proves actual password/MFA admission, without copying cookies.
  const session = await context.browser().newContext({
    baseURL: new URL(url).origin,
    ignoreHTTPSErrors: m.topology === 'host',
    serviceWorkers: 'block',
  })
  const measured = await session.newPage()
  measured.setDefaultTimeout(15_000)
  await loginViaUi(measured, email)
  await context.close()
  return {
    page: measured,
    fixture,
    url,
  }
}
