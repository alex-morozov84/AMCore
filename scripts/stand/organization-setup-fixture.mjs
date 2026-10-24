import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const isOrganizationMailFixture = (m) =>
  [
    'organization-setup',
    'organization-provisioning',
    'product-admin-closed-signup',
    // AMCORE_CONSOLE_SUPPORT_MAIL_PROFILES_START
    'support-mail-path',
    'support-mail-host',
    // AMCORE_CONSOLE_SUPPORT_MAIL_PROFILES_END
  ].includes(m.fixtureProfile)

export function assertOrganizationSetupFixture(m) {
  if (m.fixtureProfile === 'organization-shop' && (m.purpose !== 'e2e' || m.mocked))
    throw new Error('Organization shop fixture requires a fresh Docker E2E allocation')
  if (!isOrganizationMailFixture(m)) return
  if (m.purpose !== 'e2e' || m.mocked || !/^[a-f0-9]{64}$/.test(m.mailCaptureKey ?? ''))
    throw new Error('Organization setup fixture requires a fresh Docker E2E allocation')
}

/** Replaces only a sanitized copy's selected transport. Production code has no capture option. */
export async function prepareOrganizationSetupSource(m) {
  if (!isOrganizationMailFixture(m)) return
  assertOrganizationSetupFixture(m)
  const provisioning =
    m.fixtureProfile === 'organization-provisioning' ||
    ['support-mail-path', 'support-mail-host'].includes(m.fixtureProfile)
  const provider = provisioning ? 'resend' : 'mock'
  const path = join(
    m.snapshot,
    `apps/api/src/infrastructure/email/providers/${provider}.provider.ts`
  )
  let source = await readFile(path, 'utf8')
  if (provisioning) {
    if (!source.includes("baseUrl: 'https://api.resend.com'"))
      throw new Error('Fixture provider transport changed')
    // Even non-direct SDK paths remain internal and fail closed at the collector.
    source = source.replace(
      "baseUrl: 'https://api.resend.com'",
      "baseUrl: 'http://mail-capture:8099'"
    )
  }
  const start = source.indexOf('  async send(params: SendEmailParams): Promise<SendEmailResult> {')
  const end = source.indexOf('\n  }', start)
  if (start < 0 || end < 0)
    throw new Error('Mock email transport changed; fixture adaptation required')
  const body = `  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const credential = process.env.AMCORE_SETUP_MAIL_CAPTURE_KEY
    if (!credential || !/^[a-f0-9]{64}$/.test(credential) || !/^[a-z0-9._+-]+@e2e\\.amcore\\.test$/i.test(params.to))
      return { success: false, id: '', retryable: false, error: 'Fixture delivery refused' }
    try {
      const destination = 'http://mail-capture:8099/deliver'
      const options = {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + credential },
        body: JSON.stringify({ to: params.to, html: params.html, text: params.text ?? '' }),
        signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
      }
      params.beforeTransport?.()
      const response = await fetch(destination, options)
      return { success: response.ok, id: response.ok ? 'fixture-captured' : '', retryable: false }
    } catch { return { success: false, id: '', retryable: false, error: 'Fixture delivery unavailable' } }
  }`
  await writeFile(path, source.slice(0, start) + body + source.slice(end + 4))
}
