import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { activeEnvironment } from './compose-env-fixture.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const guide = readFileSync(join(root, 'docs/operations/deployment.md'), 'utf8')
const snippet = guide.match(/```bash\n(set -o pipefail\nimage_refs=[\s\S]*?)\n```/)[1]
const refs = ['api', 'web', 'api-migrator'].map(
  (name, index) => `example.invalid/amcore/${name}@sha256:${String(index + 1).repeat(64)}`
)

for (const invalid of [false, true]) {
  test(`documented fresh-shell extraction ${invalid ? 'rejects tags' : 'uses env-file refs'}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'amcore-image-instructions-'))
    try {
      const values = {
        ...activeEnvironment,
        COMPOSE_FILE: `${join(root, 'docker-compose.yml')}:${join(root, 'docker/compose/prod.yml')}`,
        COMPOSE_API_IMAGE: invalid ? 'example.invalid/amcore/api:latest' : refs[0],
        COMPOSE_WEB_IMAGE: refs[1],
        COMPOSE_API_MIGRATOR_IMAGE: refs[2],
      }
      const envFile = join(directory, 'synthetic.env')
      writeFileSync(
        envFile,
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')
      )
      const run = () =>
        execFileSync(
          'bash',
          [
            '--noprofile',
            '--norc',
            '-c',
            `${snippet}
printf '%s\\n' "$resolved_api_image" "$resolved_web_image" "$resolved_migrator_image"`,
          ],
          {
            cwd: root,
            env: { PATH: process.env.PATH, HOME: process.env.HOME, COMPOSE_ENV_FILES: envFile },
            encoding: 'utf8',
            timeout: 15000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
      if (invalid) {
        assert.throws(
          run,
          (error) => error.status !== 0 && /immutable image references/.test(error.stderr)
        )
      } else {
        assert.deepEqual(run().trim().split('\n'), refs)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
