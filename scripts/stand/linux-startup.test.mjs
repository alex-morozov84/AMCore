import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './process.mjs'
import { snapshot } from './snapshot.mjs'
import { root } from './state.mjs'
import { engine } from './docker.mjs'

test(
  'Linux managed mocked startup and supervisor verifier use a private portable socket',
  { skip: process.env.AMCORE_LINUX_PROOF !== '1' },
  async () => {
    const uuid = randomUUID()
    const fixture = await mkdtemp(join(tmpdir(), 'amcore-linux-proof-'))
    await snapshot(root, fixture)
    const { context } = await engine()
    const name = `amcore-linux-proof-${uuid}`
    const docker = (args, options = {}) => run('docker', ['--context', context, ...args], options)
    const image = JSON.parse(
      await docker(['image', 'inspect', 'node:24-slim'], { capture: true })
    )[0].Id
    let verified = false
    const command = [
      'test ! -d /private/tmp',
      'npm install -g pnpm@11.1.2',
      'apt-get update && apt-get install -y procps git',
      'git init --quiet && git add -A && git -c user.name=fixture -c user.email=fixture@example.test commit --quiet -m fixture',
      'pnpm install --frozen-lockfile',
      'node --test scripts/stand/supervisor.test.mjs scripts/stand/control-socket.test.mjs scripts/stand/lease.test.mjs scripts/stand/descendant.test.mjs scripts/stand/descendant-recovery.test.mjs scripts/stand/descendant-escape.test.mjs',
      'pnpm --filter web exec playwright install --with-deps chromium',
      "pnpm stand e2e --lane mocked --id linux-proof -- --workers=1 --grep='an unrecognized API failure|hides the Google entry point'",
    ].join(' && ')
    try {
      await docker([
        'run',
        '--init',
        '--name',
        name,
        '--label',
        `org.amcore.proof=${uuid}`,
        '--label',
        `org.amcore.worktree=${root}`,
        '--mount',
        `type=bind,source=${fixture},target=/proof`,
        '--workdir',
        '/proof',
        '--env',
        'CI=true',
        '--entrypoint',
        'sh',
        image,
        '-c',
        command,
      ])
      const record = JSON.parse(await docker(['inspect', name], { capture: true }))[0]
      assert.equal(record.State.ExitCode, 0)
      verified = true
    } finally {
      const record = JSON.parse(await docker(['inspect', name], { capture: true }))[0]
      assert.equal(record.Config.Labels['org.amcore.proof'], uuid)
      assert.ok(
        record.Mounts.some((mount) => mount.Source === fixture && mount.Destination === '/proof')
      )
      await docker(['container', 'rm', '-f', record.Id])
      assert.equal(
        (
          await docker(['container', 'ls', '-aq', '--filter', `label=org.amcore.proof=${uuid}`], {
            capture: true,
          })
        ).trim(),
        ''
      )
      if (verified) await rm(fixture, { recursive: true })
      else console.error(`Linux proof failed; source/reports retained: ${fixture}`)
    }
  }
)
