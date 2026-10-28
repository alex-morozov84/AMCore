// Explicit Linux UID/mode regression; run with node --test, never the default fast lane.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const image = readFileSync(join(scripts, 'lib.sh'), 'utf8').match(/^NODE_IMAGE=(.+)$/m)?.[1]
assert.ok(image, 'use the same pinned Node image as recover.sh')
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' })

test('root helper stdout becomes a private readable file owned by the Linux operator', () => {
  const directory = mkdtempSync(join(tmpdir(), 't080-ownership-'))
  const project = 'amcore-loadtest-ownertest'
  const fixtures = {
    config: {
      name: project,
      services: { caddy: { image: 'caddy:2-alpine' } },
      networks: { default: { name: `${project}_default` } },
    },
    volumes: [],
    networks: [
      {
        Name: `${project}_default`,
        Labels: {
          'com.docker.compose.project': project,
          'com.docker.compose.network': 'default',
        },
      },
    ],
  }
  for (const [name, value] of Object.entries(fixtures))
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(value), { mode: 0o600 })
  assert.equal(docker('run', '--rm', image, 'id', '-u').trim(), '0')
  const output = docker(
    'run',
    '--rm',
    '-v',
    `${directory}:/d:ro`,
    '-v',
    `${scripts}:/lt:ro`,
    image,
    'node',
    '/lt/recover-caddy.mjs',
    '/d',
    project
  )
  // Linux shell redirection, not the root producer, creates the output inode.
  const shell = `set -eu
    d=$(mktemp -d)
    chmod 700 "$d"
    trap 'rm -rf "$d"' EXIT
    (umask 077; cat > "$d/caddy.json")
    test "$(stat -c %u:%g:%a "$d")" = 1001:1001:700
    test "$(stat -c %u:%g:%a "$d/caddy.json")" = 1001:1001:600
    node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1])); if (!m.services.caddy || m.services.postgres) process.exit(1)' "$d/caddy.json"
    echo 'PASS Linux uid=1001 gid=1001 directory=0700 model=0600 readable'
  `
  const result = execFileSync(
    'docker',
    ['run', '--rm', '-i', '--user', '1001:1001', image, 'sh', '-c', shell],
    { input: output, encoding: 'utf8' }
  )
  assert.match(result, /PASS Linux uid=1001 gid=1001 directory=0700 model=0600 readable/)
  assert.deepEqual(Object.keys(JSON.parse(output).services), ['caddy'])
})
