import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

for (const value of ['false', 'true', undefined]) {
  test(`reference Compose forwards creation policy ${value ?? '(default)'} to API/CLI and worker`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'amcore-compose-policy-'))
    const envFile = join(directory, 'policy.env')
    try {
      writeFileSync(
        envFile,
        value === undefined ? '' : `ORG_SELF_SERVICE_CREATION_ENABLED=${value}\n`
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
          { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8' }
        )
      )
      // `docker compose run ... api node dist/cli/organization-setup.js ...`
      // changes the command, not this resolved API service environment.
      for (const service of ['api', 'worker']) {
        assert.equal(
          config.services[service].environment.ORG_SELF_SERVICE_CREATION_ENABLED,
          value ?? 'true'
        )
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
