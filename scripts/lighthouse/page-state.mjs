import { invariant, digest } from '../lib/lighthouse-plan.mjs'

export async function assertMeasuredPage(page, scenario, fixture, url) {
  invariant(page.url() === url, 'unexpected-measured-url')
  if (scenario.id === 'members') {
    await page
      .getByRole('heading', { name: fixture.organizationName, exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page
      .getByRole('row')
      .filter({ hasText: fixture.email })
      .waitFor({ state: 'visible', timeout: 10_000 })
  }
  let isolatedSession = false
  // AMCORE_CONSOLE_LIGHTHOUSE_STATE_START
  if (scenario.scope === 'console') {
    if (fixture.consoleHost) {
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
      invariant((await page.content()).includes(binding), 'measured-session-fence-missing')
      await page
        .getByRole('button')
        .filter({ hasText: fixture.email })
        .waitFor({ state: 'visible', timeout: 10_000 })
      isolatedSession = true
    }
    const access = await page.evaluate(
      async (path) => (await fetch(path, { redirect: 'error' })).status,
      fixture.accessPath
    )
    invariant(access === 204, 'console-audience-refused')
    await page
      .locator('#overview-api-checks time')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
  }
  // AMCORE_CONSOLE_LIGHTHOUSE_STATE_END
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
    async ({ anonymous, expected, isolatedSession }) => {
      const response = isolatedSession
        ? undefined
        : await fetch('/api/auth/me', {
            credentials: 'same-origin',
            redirect: 'error',
          })
      const body = response ? await response.json().catch(() => ({})) : {}
      const user = body.user
      const fields = [...globalThis.document.querySelectorAll('input')]
      return {
        subject:
          isolatedSession ||
          (anonymous ? response.status === 401 && !user : response.ok && user?.id === expected),
        fence:
          isolatedSession || anonymous || Boolean(response.headers.get('x-amcore-context-session')),
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
    { anonymous: scenario.id === 'login', expected: fixture.subject, isolatedSession }
  )
  for (const [passed, reason] of [
    [state.subject, 'measured-subject-refused'],
    [state.fence, 'measured-session-fence-missing'],
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
    if (
      response.status() >= 400 &&
      !(anonymous && url.pathname === '/api/auth/me' && response.status() === 401)
    )
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
