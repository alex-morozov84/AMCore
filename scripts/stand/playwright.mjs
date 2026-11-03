import { toolingFingerprint, compiledFingerprint } from '../lighthouse/reuse.mjs'
import { runAuditPhase } from './lighthouse-phase.mjs'
import { setProcessDeadline } from './process.mjs'
import { prepareMfaE2E } from './mfa-e2e.mjs'
import { admitInvocation, endInvocation } from './invocation.mjs'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { run, cleanEnvironment } from './process.mjs'
import { relay } from './relay.mjs'
import { directory, save } from './state.mjs'
import { supervise } from './supervisor.mjs'
import { mockEnvironment } from './mock-environment.mjs'
import { allocateControlSocket } from './control-socket.mjs'
import { groupArguments, profileInventory } from './test-inventory.mjs'

export async function test(m, lane, token, extra = [], group, auditOnly = false) {
  m.auditOnly = auditOnly
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
  if (process.env.AMCORE_AUDIT_OWNER) {
    m.buildSourceHash ??= m.sourceHash
    m.auditToolsHash = await toolingFingerprint(m.snapshot)
    m.compiledFingerprint = await compiledFingerprint(m.snapshot)
  }
  m.runToken = token
  m.lane = lane
  await save(m)
  let close
  try {
    if (!mocked) {
      await admitInvocation(m)
      await prepareMfaE2E(m)
    }
    close = await supervise(m, token)
    const config = mocked ? 'playwright.config.ts' : `playwright.${lane}.config.ts`
    const options = {
      cwd,
      env: cleanEnvironment({
        ...(mocked ? mockEnvironment(m) : {}),
        TMPDIR: tmp,
        AMCORE_STAND_MANIFEST: join(directory(m.id), 'manifest.json'),
        AMCORE_STAND_TOKEN: token,
      }),
    }
    if (!auditOnly && !group) await profileInventory(m, lane, options, extra)
    const filters = !auditOnly && group ? await groupArguments(m, group, options) : []
    if (!auditOnly)
      await run(
        'pnpm',
        [
          '--filter',
          'web',
          'exec',
          'playwright',
          'test',
          `--config=${config}`,
          ...filters,
          ...extra,
        ],
        options
      )
    m.testOutcome = auditOnly ? 'not_run_local_audit' : 'passed'
    if (process.env.AMCORE_AUDIT_OWNER) await runAuditPhase(m, token)
  } catch (error) {
    if (!['passed', 'not_run_local_audit'].includes(m.testOutcome)) m.testOutcome = 'failed'
    throw error
  } finally {
    if (process.env.AMCORE_AUDIT_OWNER)
      setProcessDeadline(
        Math.min(Date.now() + 30_000, Number(process.env.AMCORE_AUDIT_EPOCH) + 35.5 * 60_000)
      )
    endInvocation(m)
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
