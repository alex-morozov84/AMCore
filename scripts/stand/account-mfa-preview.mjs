import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/** One UI inspection journey; no traces, screenshots or real MFA state. */
export async function accountMfaPreview(page, m) {
  const messages = JSON.parse(
    await readFile(join(m.snapshot, `apps/web/messages/${m.baseLocale}.json`), 'utf8')
  )
  const t = messages.accountMfa
  await page.goto(`${m.origins.product}${m.localePrefix}/mfa`)
  await page.getByRole('heading', { name: t.preview.title, exact: true }).waitFor()
  await page.getByRole('button', { name: t.startSetup, exact: true }).click()
  await page.getByLabel(t.password, { exact: true }).fill('demo-password')
  await page.getByRole('button', { name: t.continue, exact: true }).click()
  await page.getByRole('button', { name: t.connectApp, exact: true }).click()
  await page.getByRole('img', { name: t.qrLabel, exact: true }).waitFor()
  await page.getByRole('button', { name: t.back, exact: true }).click()
  await page.getByRole('button', { name: t.connectApp, exact: true }).waitFor()
  if (await page.getByLabel(t.appCode, { exact: true }).count())
    throw new Error('Back must leave the code form without submitting it')
  await page.getByRole('button', { name: t.connectApp, exact: true }).click()
  await page.getByRole('img', { name: t.qrLabel, exact: true }).waitFor()
  await page.locator('details summary').click()
  const secret = await page.locator('details code').innerText()
  const { generate, verify } = createRequire(join(m.worktree, 'apps/web/package.json'))('otplib')
  let invalid = '000000'
  for (let value = 0; (await verify({ secret, token: invalid, epochTolerance: 30 })).valid; value++)
    invalid = String(value + 1).padStart(6, '0')
  await page.getByLabel(t.appCode, { exact: true }).fill(invalid)
  await page.getByRole('button', { name: t.continue, exact: true }).click()
  await page.getByText(messages.errors.MFA_INVALID_PROOF, { exact: true }).waitFor()
  const token = await generate({ secret, algorithm: 'sha1', digits: 6, period: 30 })
  await page.getByLabel(t.appCode, { exact: true }).fill(token)
  await page.getByRole('button', { name: t.continue, exact: true }).click()
  await page.getByText(t.codesDescription, { exact: true }).waitFor()
  if ((await page.getByRole('listitem').count()) !== 10)
    throw new Error('MFA demo must display ten backup codes')
  if (!(await page.getByRole('button', { name: t.finishSetup, exact: true }).isDisabled()))
    throw new Error('MFA demo must require the saved-codes acknowledgement')
  await page.getByRole('checkbox', { name: t.savedCheckbox, exact: true }).click()
  await page.getByRole('button', { name: t.finishSetup, exact: true }).click()
  await page.getByText(t.enabled, { exact: true }).waitFor()
  // Keep ordinary preview screenshots outside every secret-display step.
  await page.goto(`${m.origins.product}${m.localePrefix}`)
  console.log(
    'Account MFA UI simulation: invalid code rejected, live TOTP accepted, ten codes and acknowledgement verified; no active MFA authority.'
  )
}
