import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { run, cleanEnvironment } from './process.mjs'
import { relay } from './relay.mjs'
import { directory, save } from './state.mjs'
import { supervise } from './supervisor.mjs'
import { mockEnvironment } from './mock-environment.mjs'
import { allocateControlSocket } from './control-socket.mjs'

export async function test(m, lane, token, extra = []) {
  const mocked = lane === 'mocked'
  const cwd = m.snapshot
  const tmp = `${m.worktree}/.amcore/stands/${m.id}/tmp`
  await mkdir(tmp, { recursive: true, mode: 0o700 })
  await run('pnpm', ['install', '--frozen-lockfile'], {
    cwd,
    env: cleanEnvironment(mocked ? mockEnvironment(m) : {}),
  })
  await run('pnpm', ['--filter', 'shared', 'build'], {
    cwd,
    env: cleanEnvironment(mocked ? mockEnvironment(m) : {}),
  })
  const proxy = await relay(Object.values(m.origins))
  m.controlSocket = await allocateControlSocket()
  m.relay = proxy.url
  m.runToken = token
  m.lane = lane
  await save(m)
  let close
  try {
    close = await supervise(m, token)
    const config = mocked ? 'playwright.config.ts' : `playwright.${lane}.config.ts`
    await run(
      'pnpm',
      ['--filter', 'web', 'exec', 'playwright', 'test', `--config=${config}`, ...extra],
      {
        cwd,
        env: cleanEnvironment({
          ...(mocked ? mockEnvironment(m) : {}),
          TMPDIR: tmp,
          AMCORE_STAND_MANIFEST: join(directory(m.id), 'manifest.json'),
          AMCORE_STAND_TOKEN: token,
        }),
      }
    )
    m.testOutcome = 'passed'
  } catch (error) {
    m.testOutcome = 'failed'
    throw error
  } finally {
    if (close) {
      await close()
      delete m.controlSocket
    }
    await proxy.close()
    delete m.runToken
    delete m.relay
    await save(m)
  }
}
