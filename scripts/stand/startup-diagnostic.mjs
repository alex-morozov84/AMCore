import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compose } from './docker.mjs'

// Docker inspect/environment and arbitrary application log text may contain credentials.
// Preserve only the owned project's readiness facts before its failure cleanup removes them.
export async function startupDiagnostic(m) {
  if (process.env.CI !== 'true' || m.purpose !== 'e2e') return
  try {
    const text = await compose(m, ['ps', '--all', '--format', 'json'], { capture: true })
    const rows = text.trim().startsWith('[')
      ? JSON.parse(text)
      : text.trim().split('\n').filter(Boolean).map(JSON.parse)
    const services = rows
      .filter((row) =>
        ['api', 'worker', 'web', 'postgres', 'redis', 'migrate', 'seed', 'caddy'].includes(
          row.Service
        )
      )
      .map((row) => ({
        service: row.Service,
        exit: Number.isInteger(row.ExitCode) ? row.ExitCode : null,
        state: ['running', 'exited', 'created', 'restarting', 'dead'].includes(row.State)
          ? row.State
          : 'unknown',
        health: ['healthy', 'unhealthy', 'starting', ''].includes(row.Health)
          ? row.Health
          : 'unknown',
      }))
    const directory = join(m.worktree, '.amcore/ci-diagnostics')
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, `${m.id}-startup.json`),
      JSON.stringify({ phase: 'startup', services }),
      { mode: 0o600 }
    )
    console.error('Stand startup failed:', JSON.stringify(services))
  } catch {
    console.error('Stand startup failed; safe readiness diagnostics unavailable')
  }
}
