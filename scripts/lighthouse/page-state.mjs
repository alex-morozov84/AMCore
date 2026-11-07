import { sessionProbe, boundDocument, probeProof } from './session-probe.mjs'
import BFCacheFailures from 'lighthouse/core/gather/gatherers/bf-cache-failures.js'
import { invariant } from '../lib/lighthouse-plan.mjs'

export function measuredErrorKind(error) {
  const text = String(error?.message ?? '')
  for (const [pattern, kind] of [
    [/context.*destroyed|cannot find context/i, 'context-destroyed'],
    [/handle.*disposed|disposed.*handle/i, 'handle-disposed'],
    [/target.*closed|browser.*closed|page.*closed/i, 'target-closed'],
    [/timeout|timed out/i, 'timeout'],
  ])
    if (pattern.test(text)) return kind
  return 'other'
}

export async function assertMeasuredPage(
  page,
  scenario,
  fixture,
  url,
  captured = page.evaluateHandle(() => globalThis.document),
  check = {}
) {
  const document = await captured
  invariant(page.url() === url, 'unexpected-measured-url')
  await page.waitForLoadState('domcontentloaded')
  check.stage = 'session-probe'
  check.probeStart = probeProof(page.context()).length
  const binding = await sessionProbe(
    page.context(),
    url,
    scenario.id === 'login' ? undefined : fixture.subject,
    fixture.consoleHost ? 'console' : fixture.staffHost ? 'staff' : 'product',
    fixture.accessPath
  )
  check.probeEnd = probeProof(page.context()).length
  check.stage = 'binding'
  if (binding) await boundDocument(document, binding)
  if (scenario.id === 'members') {
    check.stage = 'members-heading'
    await page
      .getByRole('heading', { name: fixture.organizationName, exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 })
    check.stage = 'members-record'
    await page
      .locator('tr, [data-slot="card"]')
      .filter({ has: page.getByText(fixture.email, { exact: true }), visible: true })
      .waitFor({ state: 'visible', timeout: 10_000 })
  }
  check.stage = 'remaining-page-readiness'
  if (scenario.scope === 'console') {
    if (fixture.consoleHost) {
      const { digest } = await import('../lib/lighthouse-plan.mjs')
      const { redisEntry } = await import('../../apps/web/e2e/console-real-stack/helpers.ts')
      const cookie = (await page.context().cookies(url)).find(
        (item) => item.name === '__Host-amcore_console_session'
      )
      invariant(cookie?.secure && cookie.httpOnly, 'measured-subject-refused')
      const entry = redisEntry(`web:console-session:v1:${cookie.value}`)
      invariant(
        entry.audience === 'console' && entry.userSnapshot?.id === fixture.subject,
        'measured-subject-refused'
      )
      const binding = digest(
        JSON.stringify(['product-context-v2', 'console', cookie.value, fixture.subject])
      )
      await boundDocument(document, binding)
      await page
        .getByRole('button')
        .filter({ hasText: fixture.email })
        .waitFor({ state: 'visible', timeout: 10_000 })
    }
    await page
      .locator('#overview-api-checks time')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
  }
  if (scenario.id === 'login')
    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction(
    () =>
      ![...globalThis.document.querySelectorAll('[aria-busy="true"]')].some(
        (el) => el.getClientRects().length
      ),
    undefined,
    { timeout: 10_000 }
  )
  await page.evaluate(() => globalThis.document.fonts.ready.then(() => undefined))
  const state = await page.evaluate(
    ({ expected }) => {
      const fields = [...globalThis.document.querySelectorAll('input')]
      return {
        credentials: fields.some(
          (input) => /^(password|email)$/.test(input.type) && input.value !== ''
        ),
        busy: [...globalThis.document.querySelectorAll('[aria-busy="true"]')].some(
          (el) => el.getClientRects().length
        ),
        indexable: !/noindex/i.test(
          globalThis.document.querySelector('meta[name="robots"]')?.content ?? ''
        ),
        hasPassword: Boolean(globalThis.document.querySelector('input[type="password"]')),
        row: expected
          ? [...globalThis.document.querySelectorAll('tr')].some((r) =>
              r.textContent?.includes(expected)
            )
          : false,
      }
    },
    { expected: fixture.subject }
  )
  for (const [passed, reason] of [
    [!state.credentials, 'measured-credentials-present'],
    [!state.busy, 'measured-state-busy'],
  ])
    invariant(passed, reason)
  if (scenario.id === 'login')
    invariant(
      state.hasPassword &&
        !new URL(page.url()).search &&
        (await page.locator('input[type="email"]').count()) === 1,
      'invalid-anonymous-form'
    )
  else invariant(!state.hasPassword, 'auth-setup-page-refused')
  check.stage = 'final-document-check'
  invariant(
    await document.evaluate((doc) => doc === globalThis.document),
    'navigation-identity-refused'
  )
  check.stage = 'disposal'
  await document.dispose()
  return { identity: true, indexable: state.indexable }
}

export function watchMeasuredPage(page, origin, anonymous, subject) {
  const failures = []
  const pending = []
  const onResponse = (response) => {
    const url = new URL(response.url())
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return
    if (!anonymous && url.pathname === '/api/auth/me' && response.ok())
      pending.push(
        response
          .json()
          .then((body) => {
            if (body.user?.id !== subject) failures.push({ kind: 'subject-changed-during-audit' })
          })
          .catch(() => failures.push({ kind: 'invalid-profile-response' }))
      )
    if (response.status() >= 400)
      failures.push({
        status: response.status(),
        kind: response.status() === 429 ? 'required-data-429' : 'required-data-refused',
      })
  }
  const onRequestFailed = (request) => {
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname.startsWith('/api/'))
      failures.push({ kind: 'required-data-transport' })
  }
  page.on('response', onResponse)
  page.on('requestfailed', onRequestFailed)
  return {
    async assert() {
      await Promise.all(pending)
      invariant(failures.length === 0, failures[0]?.kind ?? 'required-data-failed')
    },
    close() {
      page.off('response', onResponse)
      page.off('requestfailed', onRequestFailed)
    },
  }
}

export function bfCacheConfig(verifyPending) {
  class CheckedBFCacheFailures extends BFCacheFailures {
    async getArtifact(context) {
      await verifyPending()
      return super.getArtifact(context)
    }
  }
  return {
    extends: 'lighthouse:default',
    artifacts: [{ id: 'BFCacheFailures', gatherer: CheckedBFCacheFailures }],
  }
}
