import { readFile, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { invariant, auditChoices } from '../lib/lighthouse-plan.mjs'
import { safeBody } from '../lib/lighthouse-reports.mjs'
import { sessionProbe, probeProof } from './session-probe.mjs'
import { prepareFixture } from './fixture.mjs'
import { activeTarget } from '../../apps/web/e2e/support/managed-target.mjs'
import { assertMeasuredPage, watchMeasuredPage } from './page-state.mjs'

export async function saveAcceptanceFixture(page, fixture, url, directory) {
  await writeFile(join(directory, 'fixture.json'), JSON.stringify({ ...fixture, url }), {
    mode: 0o600,
  })
  await page.context().storageState({ path: join(directory, 'state.json') })
  await chmod(join(directory, 'state.json'), 0o600)
}

export async function restoreAcceptance(context, mode, directory, scenario, helpers) {
  context.setDefaultTimeout(120_000)
  const fixture = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8'))
  if (mode === 'sign-in-stall') {
    await context.route(/\/api\/(?:.*\/)?auth\/login(?:\?.*)?$/, async () => {
      await writeFile(join(directory, 'entered-sign-in-stall.json'), '{"stage":"sign-in"}', {
        mode: 0o600,
      })
      return new Promise(() => {})
    })
    const page = await context.newPage()
    await helpers.loginViaUi(page, fixture.email)
    throw new Error('sign-in-stall-did-not-stall')
  }
  const page = await context.newPage()
  await page.goto(fixture.url, { waitUntil: 'domcontentloaded' })
  await assertMeasuredPage(page, scenario, fixture, fixture.url)
  if (['split-document', 'retired-session'].includes(mode)) {
    let body
    if (mode === 'split-document') {
      const m = activeTarget()
      const other = await prepareFixture(
        await context.browser().newContext({
          baseURL: m.origins.product,
          proxy: { server: m.relay },
          ignoreHTTPSErrors: m.topology === 'host',
        }),
        m,
        scenario,
        auditChoices(m.snapshot).productAdmin.alias
      )
      try {
        await other.page.goto(other.url, { waitUntil: 'domcontentloaded' })
        await assertMeasuredPage(other.page, scenario, other.fixture, other.url)
        invariant(other.fixture.subject !== fixture.subject, 'missing-negative-subject')
        body = await other.page.content()
      } finally {
        await other.page.context().close()
      }
    } else {
      body = await page.content()
      const audience = fixture.consoleHost ? 'console' : fixture.staffHost ? 'staff' : 'product'
      const before = await sessionProbe(
        context,
        fixture.url,
        fixture.subject,
        audience,
        fixture.accessPath
      )
      await helpers.logoutViaApi(
        context.request,
        new URL(fixture.url).origin,
        fixture.staffHost ? '/api/product-admin/auth/logout' : '/api/auth/logout'
      )
      await helpers.loginViaUi(page, fixture.email)
      const after = await sessionProbe(
        context,
        fixture.url,
        fixture.subject,
        audience,
        fixture.accessPath
      )
      invariant(
        before !== after && body.includes(before) && !body.includes(after),
        'retired-document-not-prepared'
      )
    }
    await page.route(fixture.url, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
    )
    return { page, fixture, url: fixture.url }
  }
  if (mode === 'page-401') {
    const watcher = watchMeasuredPage(page, new URL(fixture.url).origin, true)
    try {
      await page.route('**/api/audit-fixture-refusal', (route) =>
        route.fulfill({ status: 401, body: '{}' })
      )
      await page.evaluate(() => fetch('/api/audit-fixture-refusal'))
      await expectRefusal(() => watcher.assert())
    } finally {
      watcher.close()
    }
    return { acceptedRefusal: true }
  }
  if (mode === 'product-on-console-host') {
    const m = activeTarget()
    const options = {
      baseURL: m.origins.product,
      proxy: { server: m.relay },
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    }
    const product = await context.browser().newContext(options)
    let fresh,
      step = 'console-fixture'
    try {
      // Both real MFA sign-ins share this process's existing backup-code wallet.
      fresh = await prepareFixture(
        await context.browser().newContext(options),
        m,
        scenario,
        auditChoices(m.snapshot).productAdmin.alias
      )
      const consoleContext = fresh.page.context()
      step = 'console-check'
      await fresh.page.goto(fresh.url, { waitUntil: 'domcontentloaded' })
      await assertMeasuredPage(fresh.page, scenario, fresh.fixture, fresh.url)
      const actual = (await consoleContext.cookies(fresh.url)).find(
        (c) => c.name === '__Host-amcore_console_session'
      )
      invariant(actual, 'console-session-missing')
      step = 'product-sign-in'
      await helpers.loginViaUi(await product.newPage(), fresh.fixture.email)
      step = 'product-proof'
      await sessionProbe(product, m.origins.product, fresh.fixture.subject, 'product')
      const cookie = (await product.cookies(m.origins.product)).find(
        (c) => c.name === 'amcore_session'
      )
      invariant(cookie, 'product-session-missing')
      step = 'audience-refusal'
      await consoleContext.addCookies([{ ...actual, value: cookie.value }])
      await expectRefusal(() =>
        sessionProbe(
          consoleContext,
          fresh.url,
          fresh.fixture.subject,
          'console',
          fresh.fixture.accessPath
        )
      )
      const denial = probeProof(consoleContext).at(-1)
      invariant(denial?.path === '/api/access' && denial.status === 401, 'console-audience-refused')
      step = 'complete'
    } finally {
      await Promise.all([
        product.close(),
        fresh?.page.context().close(),
        writeFile(
          join(directory, 'host-control-proof.json'),
          JSON.stringify({
            step,
            product: probeProof(product),
            console: probeProof(fresh?.page.context()),
          }),
          { flag: 'wx', mode: 0o600 }
        ),
      ])
    }
    return { acceptedRefusal: true }
  }
  if (mode === 'audit-stall') {
    // Hold Lighthouse's actual main navigation, with the browser and owned tree live.
    return { page, fixture, url: fixture.url }
  }
  if (mode === 'wrong-user') {
    invariant(
      fixture.otherSubject && fixture.otherSubject !== fixture.subject,
      'missing-negative-subject'
    )
    await expectRefusal(() =>
      assertMeasuredPage(page, scenario, { ...fixture, subject: fixture.otherSubject }, fixture.url)
    )
  } else if (mode === 'expired') {
    return { page, fixture, url: fixture.url }
  } else if (mode === 'failed-login-canary') {
    const canary = 'AUDIT_CANARY_DO_NOT_EXPORT'
    const login = new URL(fixture.url)
    login.pathname = login.pathname.replace(/\/organizations\/.*$/, '/login')
    await page.context().clearCookies()
    await page.goto(login.href, { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="email"]').fill(fixture.email)
    await page.locator('input[type="password"]').fill(canary)
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST'
    )
    await page.locator('button[type="submit"]').click()
    invariant((await response).status() === 401, 'failed-login-control-not-refused')
    await page.evaluate(
      (secret) =>
        globalThis.document.querySelector('input[type="password"]').setAttribute('value', secret),
      canary
    )
    await expectRefusal(() => assertMeasuredPage(page, scenario, fixture, fixture.url))
    let refused = false
    try {
      safeBody(await page.content(), [canary])
    } catch {
      refused = true
    }
    invariant(refused, 'failed-login-canary-was-exportable')
  } else throw new Error('unknown-acceptance-control')
  return { acceptedRefusal: true }
}

async function expectRefusal(action) {
  let refused = false
  try {
    await action()
  } catch {
    refused = true
  }
  invariant(refused, 'negative-state-was-accepted')
}
