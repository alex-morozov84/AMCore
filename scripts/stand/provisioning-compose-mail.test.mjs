import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
for (const provider of ['mock', 'resend', undefined]) {
  test(`reference Compose forwards mail ${provider ?? '(default)'} without an overlay`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'amcore-provisioning-mail-'))
    const envFile = join(directory, 'mail.env')
    try {
      writeFileSync(
        envFile,
        [
          ...(provider ? [`EMAIL_PROVIDER=${provider}`] : []),
          'RESEND_API_KEY=<fake-compose-test-key>',
          'EMAIL_FROM=sender@example.test',
          'FRONTEND_URL=https://shop.example.test',
        ].join('\n')
      )
      const config = JSON.parse(
        execFileSync(
          'docker',
          [
            'compose',
            '--env-file',
            envFile,
            '-f',
            join(root, 'docker-compose.yml'),
            'config',
            '--format',
            'json',
          ],
          {
            cwd: root,
            env: { PATH: process.env.PATH, HOME: process.env.HOME },
            encoding: 'utf8',
          }
        )
      )
      for (const service of ['api', 'worker']) {
        const env = config.services[service].environment
        assert.equal(env.EMAIL_PROVIDER, provider ?? 'mock')
        assert.equal(env.RESEND_API_KEY, '<fake-compose-test-key>')
        assert.equal(env.EMAIL_FROM, 'sender@example.test')
        assert.equal(env.FRONTEND_URL, 'https://shop.example.test')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
