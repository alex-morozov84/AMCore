import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function assertOrganizationSetupFixture(m) {
  if (m.fixtureProfile === 'organization-shop' && (m.purpose !== 'e2e' || m.mocked))
    throw new Error('Organization shop fixture requires a fresh Docker E2E allocation')
  if (m.fixtureProfile !== 'organization-setup') return
  if (m.purpose !== 'e2e' || m.mocked || !/^[a-f0-9]{64}$/.test(m.mailCaptureKey ?? ''))
    throw new Error('Organization setup fixture requires a fresh Docker E2E allocation')
}

/** Replaces only a sanitized copy's mock transport. Production source and env schema stay unchanged. */
export async function prepareOrganizationSetupSource(m) {
  if (m.fixtureProfile !== 'organization-setup') return
  assertOrganizationSetupFixture(m)
  const path = join(m.snapshot, 'apps/api/src/infrastructure/email/providers/mock.provider.ts')
  const source = await readFile(path, 'utf8')
  const start = source.indexOf('  async send(params: SendEmailParams): Promise<SendEmailResult> {')
  const end = source.indexOf('\n  }\n}', start)
  if (start < 0 || end < 0)
    throw new Error('Mock email transport changed; fixture adaptation required')
  const body = `  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const credential = process.env.AMCORE_SETUP_MAIL_CAPTURE_KEY
    if (!credential || !/^[a-f0-9]{64}$/.test(credential) || !/^[a-z0-9._+-]+@e2e\\.amcore\\.test$/i.test(params.to))
      return { success: false, id: '', retryable: false, error: 'Fixture delivery refused' }
    try {
      const response = await fetch('http://mail-capture:8099/deliver', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + credential },
        body: JSON.stringify({ to: params.to, html: params.html, text: params.text ?? '' }),
        signal: AbortSignal.timeout(3000),
      })
      return { success: response.ok, id: response.ok ? 'fixture-captured' : '', retryable: false }
    } catch { return { success: false, id: '', retryable: false, error: 'Fixture delivery unavailable' } }
  }`
  await writeFile(path, source.slice(0, start) + body + source.slice(end + 4))
}
