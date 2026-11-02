import { createHmac } from 'node:crypto'

import { sql } from './ownership.mjs'
import { loadFactor, saveFactor, totp } from './operator-totp.mjs'

// Operator sign-in on a PREVIEW stand. Since operator MFA became mandatory, a SUPER_ADMIN cannot sign
// in unless the database protocol is active and the API has an encryption key. A preview stand gets
// both - in its own disposable database only - and the preview command enrolls the demo operator
// through the real enrollment screen. Nothing changes in application code or in any deployment;
// enforcement stays on and the real sign-in path is exercised. `pnpm stand code --id <id>` prints the
// current code. The Console host topology has its own sign-in and is not covered here.

/** Decided once when the stand is created, so its environment never changes afterwards. */
export function operatorMfaWanted({
  purpose,
  mocked,
  consoleEnabled,
  consoleTopology,
  fixtureProfile,
}) {
  return (
    purpose === 'preview' &&
    !mocked &&
    Boolean(consoleEnabled) &&
    consoleTopology !== 'host' &&
    !['account-mfa-ui', 'user'].includes(fixtureProfile)
  )
}

export function operatorMfaEnvironment(m) {
  if (!m.operatorMfa) return {}
  if (typeof m.jwtSecret !== 'string' || m.jwtSecret.length < 32)
    throw new Error('Operator MFA key requires the owned stand secret')
  return {
    MFA_ACTIVE_KEY_ID: 'managed-preview',
    MFA_ENCRYPTION_KEYS: JSON.stringify({
      'managed-preview': createHmac('sha256', m.jwtSecret)
        .update('mfa-preview-key-v1')
        .digest('base64'),
    }),
  }
}

/** Seeds the protocol row in the stand's own database, like the e2e fixture; not deployment activation. */
export async function prepareOperatorMfa(m, execute = sql) {
  if (!m.operatorMfa) return
  const output = await execute(
    m,
    `INSERT INTO core.mfa_protocol (id, state, version, "updatedAt")
      SELECT 'platform', 'active', 1, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM core.mfa_protocol WHERE id = 'platform');
      UPDATE core.mfa_protocol SET state = 'active', "updatedAt" = NOW()
      WHERE id = 'platform' AND version = 1 AND state IN ('prepared', 'active')
      RETURNING state || ':' || version;`
  )
  if (!output.split('\n').includes('active:1')) throw new Error('Unsupported operator MFA protocol')
}

const homePath = (m) => (m.localePrefix ? new RegExp(`^${m.localePrefix}/?$`) : /^\/$/)

async function enroll(page, m, t) {
  await page.getByRole('button', { name: t.connectApp, exact: true }).click()
  await page.getByRole('img', { name: t.qrLabel, exact: true }).waitFor()
  await page.locator('details summary').click()
  const secret = (await page.locator('details code').innerText()).trim()
  await page.getByLabel(t.appCode, { exact: true }).fill(totp(secret).code)
  await page.getByRole('button', { name: t.continue, exact: true }).click()
  await page.getByText(t.codesDescription, { exact: true }).waitFor()
  const codes = await page
    .getByRole('list', { name: t.backupCodesTitle, exact: true })
    .getByRole('listitem')
    .allTextContents()
  await saveFactor(m, { secret, backupCodes: codes })
  await page.getByRole('checkbox', { name: t.savedCheckbox, exact: true }).check()
  await page.getByRole('button', { name: t.finishSetup, exact: true }).click()
}

async function signInWithCode(page, factor, t) {
  // A code in its last second can expire on the way; wait for the next one.
  if (totp(factor.secret).secondsLeft <= 1) await page.waitForTimeout(1500)
  await page.getByLabel(t.appCode, { exact: true }).fill(totp(factor.secret).code)
  await page.locator('form button[type="submit"]').first().click()
}

/** Signs the demo operator in through the product login page; enrolls on the first run. */
export async function operatorSignIn(page, m, account, labels) {
  await page.goto(`${m.localePrefix}/login`)
  await page.getByLabel(labels.product.email, { exact: true }).fill(account.email)
  await page.getByLabel(labels.product.password, { exact: true }).fill(account.password)
  await page.getByRole('button', { name: labels.product.submit, exact: true }).click()
  await page.waitForURL(
    (url) => url.pathname === `${m.localePrefix}/mfa` && url.searchParams.has('flow')
  )
  const factor = await loadFactor(m)
  if (factor) await signInWithCode(page, factor, labels.mfa)
  else await enroll(page, m, labels.mfa)
  await page.waitForURL((url) => url.origin === m.origins.product && homePath(m).test(url.pathname))
}
