import { createHash, createPrivateKey, X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const names = ['app.mocked.localhost', 'staff.app.mocked.localhost', 'console.app.mocked.localhost']

export async function readMockTls(dir) {
  if (!dir?.startsWith('/') || !/^[/a-zA-Z0-9_.-]+$/.test(dir))
    throw new Error(
      'Local mocked HTTPS requires an absolute TLS directory without shell metacharacters'
    )
  const cert = new X509Certificate(await readFile(join(dir, 'cert.pem')))
  const key = createPrivateKey(await readFile(join(dir, 'key.pem')))
  const now = Date.now()
  if (
    now < Date.parse(cert.validFrom) ||
    now >= Date.parse(cert.validTo) ||
    !cert.checkPrivateKey(key) ||
    !cert.checkIP('127.0.0.1') ||
    !names.every((name) => cert.checkHost(name, { subject: 'never', wildcards: false }))
  )
    throw new Error('Local mocked TLS requires a current matching key and all stand names')
  const pin = createHash('sha256')
    .update(cert.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64')
  return { dir, pin }
}
