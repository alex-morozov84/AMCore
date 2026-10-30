import { expect } from '@playwright/test'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'
import { test } from '../shared/auth-test'
import { expectNoAxeViolations } from '../shared/axe'

// Client-state proof only. API cryptography and real Redis publication have separate suites.
for (const { locale, messages, width } of [
  { locale: 'en', messages: en.accountMfa, width: 1280 },
  { locale: 'ru', messages: ru.accountMfa, width: 360 },
] as const) {
  test(`server recovery shows the recovery error and grants only new-app setup (${locale})`, async ({
    page,
  }) => {
    const flowBinding = '01900000-0000-7000-8000-000000000002'
    let redeemed = false,
      attempts = 0
    const view = () =>
      redeemed
        ? {
            kind: 'flow',
            purpose: 'initial_setup',
            state: 'enrollment_required',
            accountLabel: 'preview@example.test',
            flowBinding,
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            requiredProofs: [],
            remainingCodes: 0,
            generation: 1,
          }
        : { kind: 'recovery_ticket', accountLabel: 'preview@example.test', flowBinding }
    await page.route('**/api/auth/mfa*', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: view() })
      const command = route.request().postDataJSON() as {
        action: string
        password: string
        ticket: string
        proof?: unknown
      }
      expect(command.action).toBe('redeem_recovery_ticket')
      expect(command.proof).toBeUndefined()
      attempts += 1
      if (attempts === 1)
        return route.fulfill({
          status: 422,
          json: {
            statusCode: 422,
            errorCode: 'MFA_RECOVERY_TICKET_INVALID',
            message: 'fake-recovery-refusal',
          },
        })
      redeemed = true
      return route.fulfill({ json: { view: view() } })
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/${locale}/mfa`)
    const submit = async () => {
      await page.getByLabel(messages.password, { exact: true }).fill('<fake-local-password>')
      await page.getByLabel(messages.emergencyTicket, { exact: true }).fill('r'.repeat(43))
      await page.getByRole('button', { name: messages.continue, exact: true }).click()
    }
    await submit()
    await expect(page.locator('[data-slot="alert"]')).toContainText(
      (locale === 'en' ? en : ru).errors.MFA_RECOVERY_TICKET_INVALID
    )
    await expectNoAxeViolations(page)
    await submit()
    await expect(page.getByRole('button', { name: messages.connectApp, exact: true })).toBeVisible()
    expect(attempts).toBe(2)
    await expectNoAxeViolations(page)
  })
  test(`initial MFA setup acknowledges saved codes and resumes completed setup (${locale})`, async ({
    page,
  }) => {
    const flowBinding = '01900000-0000-7000-8000-000000000001'
    const actions: string[] = []
    let state = 'enrollment_required',
      generation = 0
    const view = () => ({
      kind: 'flow',
      purpose: 'initial_setup',
      state,
      accountLabel: 'preview@example.test',
      flowBinding,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      requiredProofs: [],
      remainingCodes: generation ? 10 : 0,
      generation,
      ...(state === 'completed' ? { publication: 'confirmed' } : {}),
    })
    await page.route('**/api/auth/mfa*', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: view() })
      const command = route.request().postDataJSON() as {
        action: string
        operationId: string
        flowBinding: string
        proof?: { method: string; code: string }
        generation?: number
      }
      expect(command.flowBinding).toBe(flowBinding)
      actions.push(command.action)
      if (command.action === 'start_enrollment')
        return route.fulfill({
          json: {
            view: view(),
            enrollment: {
              secret: 'FAKEPREVIEWSEED',
              otpauthUri: 'otpauth://totp/AMCore:preview?secret=FAKEPREVIEWSEED&issuer=AMCore',
            },
          },
        })
      if (command.action === 'verify') {
        expect(command.proof).toEqual({ method: 'totp', code: '123456' })
        state = 'codes_pending'
        generation = 1
        return route.fulfill({
          json: {
            view: view(),
            backupCodes: {
              codes: Array.from(
                { length: 10 },
                (_, i) => `0000-0000-0000-0000-0000-0000-0000-${String(i + 1).padStart(4, '0')}`
              ),
              generation,
            },
          },
        })
      }
      if (command.action === 'acknowledge_codes') {
        expect(command.generation).toBe(1)
        // Simulate successful acknowledgement with a lost final publication response.
        state = 'ready'
        return route.fulfill({
          status: 503,
          json: {
            statusCode: 503,
            errorCode: 'SERVICE_UNAVAILABLE',
            message: 'fake-publication-response-loss',
          },
        })
      }
      expect(command.action).toBe('reconcile_login')
      state = 'completed'
      return route.fulfill({ json: { view: view() } })
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/${locale}/mfa`)
    await page.getByRole('button', { name: messages.connectApp, exact: true }).click()
    await expect(page.getByRole('img', { name: messages.qrLabel })).toBeVisible()
    await page.getByRole('textbox').fill('123456')
    await page.getByRole('button', { name: messages.continue, exact: true }).click()
    const finish = page.getByRole('button', { name: messages.finishSetup, exact: true })
    await expect(finish).toBeDisabled()
    await page.getByRole('checkbox', { name: messages.savedCheckbox, exact: true }).check()
    await expect(finish).toBeEnabled()
    await expectNoAxeViolations(page)
    await finish.click()
    await page.getByRole('button', { name: messages.checkResult, exact: true }).click()
    await page.waitForURL((url) => url.pathname === `/${locale}` || url.pathname === `/${locale}/`)
    expect(actions).toEqual(['start_enrollment', 'verify', 'acknowledge_codes', 'reconcile_login'])
    await expectNoAxeViolations(page)
  })
}
