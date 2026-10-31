import { readFile, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { invariant } from '../lib/lighthouse-plan.mjs'
import { safeBody } from '../lib/lighthouse-reports.mjs'
import { assertMeasuredPage } from './page-state.mjs'

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
