import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { save } from './state.mjs'

async function sendSample(page, card, kind, messages, m, expect) {
  const t = messages.console.supportMail
  await card.getByRole('button', { name: t[kind].button, exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: t.send, exact: true }).click()
  const password = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: messages.console.stepUpTitle, exact: true }) })
  const notice = page.locator('[data-slot="toast"]').filter({ hasText: t.toast.simulated })
  await expect(password.or(notice).first()).toBeVisible()
  if (await password.isVisible()) {
    await password
      .getByLabel(messages.console.loginPassword, { exact: true })
      .fill(m.accounts.find((item) => item.role === 'SUPER_ADMIN').password)
    await password.getByRole('button', { name: messages.console.stepUpSubmit, exact: true }).click()
  }
  await expect(notice.getByText(t.toast.simulated, { exact: true })).toBeVisible()
  await expect(notice.getByText(t.toastDescription.simulated, { exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0)
}

/** One safe mock action and bounded inspection of the owner-reported result states. */
export async function supportMailPreview(page, m, supportedLocales) {
  const require = createRequire(join(m.worktree, 'apps/web/package.json'))
  const { expect } = require('@playwright/test')
  const requireApi = createRequire(join(m.worktree, 'apps/api/package.json'))
  const { require: tsxRequire } = requireApi('tsx/cjs/api')
  const { expectNoAxeViolations } = tsxRequire(
    join(m.worktree, 'apps/web/e2e/shared/axe.ts'),
    import.meta.url
  )
  const record = m.supportMailFixture
  const feedback = m.supportMailFeedbackFixture
  const locales = m.localePrefix ? supportedLocales : [m.baseLocale]
  const errors = []
  let sends = 0
  let reads = 0
  page.on('pageerror', () => errors.push(true))
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/\/support-mail\/[^/]+\/send$/.test(path) && request.method() === 'POST') sends += 1
    if (/\/support-mail\/[0-9a-f-]{36}$/.test(path) && request.method() === 'GET') reads += 1
  })
  for (const locale of locales) {
    const messages = JSON.parse(
      await readFile(join(m.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    )
    const t = messages.console.supportMail
    const prefix = m.localePrefix ? `/${locale}` : ''
    const base = m.origins.console ? `${m.origins.console}${prefix}` : `${prefix}/${m.consoleSlug}`
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('heading', { name: t.title, exact: true }) })
    const target = record.targets.find((item) => item.email === 'support-local@preview.amcore.test')
    await page.setViewportSize({ width: 1280, height: 950 })
    await page.goto(`${base}/users/${target.id}`)
    await expect(
      card.getByRole('button', { name: t.email_verification.button, exact: true })
    ).toBeVisible()
    // Original preview/owner examples are inspection-only during this correction.
    await expectNoAxeViolations(page)
    await card.screenshot({
      path: `${m.worktree}/.amcore/stands/${m.id}/support-mail-desktop-${locale}.png`,
    })

    if (!feedback.checked) {
      await page.goto(`${base}/users/${feedback.id}`)
      await expect(
        card.getByRole('button', { name: t.password_recovery.button, exact: true })
      ).toBeEnabled()
      await sendSample(page, card, 'password_recovery', messages, m, expect)
      feedback.checked = true
      await save(m)
      await page
        .locator('[data-slot="toast"]')
        .filter({ hasText: t.toast.simulated })
        .screenshot({ path: `${m.worktree}/.amcore/stands/${m.id}/support-mail-toast.png` })
      await page.locator('[data-slot="toast-close"]').click()
    }

    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme })
      const failed = record.targets.find(
        (item) => item.email === 'support-failed@preview.amcore.test'
      )
      await page.goto(`${base}/users/${failed.id}`)
      // Choose an unchanged example if the owner already sent a new email for the other kind.
      const failedSection = card
        .locator('section')
        .filter({ has: page.getByText(t.summary.not_started, { exact: true }) })
        .first()
      await expect(failedSection).toBeVisible()
      const failedKind = (await failedSection
        .getByRole('heading', { name: t.password_recovery.title, exact: true })
        .count())
        ? 'password_recovery'
        : 'email_verification'
      const details = failedSection.getByRole('button', {
        name: t.detailsLabel.replace('{kind}', t[failedKind].title),
        exact: true,
      })
      await expect(details).toHaveAttribute('data-variant', 'outline')
      const sendsBeforeRead = sends
      await details.click()
      const result = page.locator('[data-slot="dialog-content"]')
      await expect(
        result.getByRole('heading', { name: t.outcomeTitle.not_started, exact: true })
      ).toBeVisible()
      await expect(result.getByText(t.reason.render_failed, { exact: true })).toHaveCount(1)
      await expect(
        result.getByText(`${t[failedKind].replaced} ${t.next.not_started}`, { exact: true })
      ).toBeVisible()
      await expect(result).not.toContainText('Если новая ссылка')
      await expect(result).not.toContainText('Этот результат описывает')
      await expectNoAxeViolations(page)
      await result.screenshot({
        path: `${m.worktree}/.amcore/stands/${m.id}/support-mail-failure-${locale}-${colorScheme}.png`,
      })
      await result
        .locator('[data-slot="dialog-footer"]')
        .getByRole('button', { name: t.close, exact: true })
        .click()
      await expect(details).toBeFocused()

      const unknown = record.targets.find(
        (item) => item.email === 'support-unknown@preview.amcore.test'
      )
      await page.goto(`${base}/users/${unknown.id}`)
      const unknownSection = card
        .locator('section')
        .filter({ has: page.getByText(t.summary.unknown, { exact: true }) })
        .first()
      await expect(unknownSection).toBeVisible()
      await unknownSection.getByRole('button', { name: new RegExp(`^${t.details}`) }).click()
      await expect(
        result.getByRole('heading', { name: t.outcomeTitle.unknown, exact: true })
      ).toBeVisible()
      const previousReads = reads
      await result.getByRole('button', { name: t.check, exact: true }).click()
      await expect(
        result.getByRole('heading', { name: t.outcomeTitle.unknown, exact: true })
      ).toBeVisible()
      if (reads <= previousReads || sends !== sendsBeforeRead)
        throw new Error('Reading a support mail result must only read')
      await expect(page.locator('[data-slot="toast"]')).toHaveCount(0)
      await expectNoAxeViolations(page)
      await page.keyboard.press('Escape')
      await expect(result).toBeHidden()
    }

    await page.emulateMedia({ colorScheme: 'light' })
    const long = record.targets.find((item) => item.email.includes('long-address'))
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`${base}/users/${long.id}`)
    const send = card.getByRole('button', { name: t.password_recovery.button, exact: true })
    await expect(send).toBeEnabled()
    await send.click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText(long.email)
    await expectNoAxeViolations(page)
    if (!(await confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)))
      throw new Error('Support mail confirmation overflows')
    await page.screenshot({
      path: `${m.worktree}/.amcore/stands/${m.id}/support-mail-confirm-${locale}.png`,
    })
    await page.keyboard.press('Escape')
    await expect(confirmation).toBeHidden()
    await expect(send).toBeFocused()
    if (
      !(await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth
      ))
    )
      throw new Error('Support mail page overflows')
    await page.screenshot({
      path: `${m.worktree}/.amcore/stands/${m.id}/support-mail-${locale}.png`,
    })
  }
  if (errors.length) throw new Error('Support mail page reported runtime errors')
  record.browserProof = {
    sourceHash: m.sourceHash,
    locales,
    themes: ['light', 'dark'],
    narrowWidth: 375,
    checkedAt: new Date().toISOString(),
  }
  await save(m)
  console.log(
    'Support mail feedback: toast, concise failed/unknown results, explicit Details, GET-only reopen, locales/themes, keyboard and accessibility passed.'
  )
}
