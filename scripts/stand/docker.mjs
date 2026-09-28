import { run } from './process.mjs'
import { withPinnedEngine } from './docker-session.mjs'

export async function engine() {
  const context = (await run('docker', ['context', 'show'], { capture: true })).trim()
  const [info] = JSON.parse(await run('docker', ['context', 'inspect', context], { capture: true }))
  const endpoint = info.Endpoints.docker.Host
  if (!endpoint.startsWith('unix://'))
    throw new Error('Managed stands require a local Unix Docker engine')
  const version = (
    await run('docker', ['--context', context, 'compose', 'version', '--short'], { capture: true })
  ).trim()
  const [major, minor, patch] = version.replace(/^v/, '').split('.').map(Number)
  if (!(major > 2 || (major === 2 && (minor > 24 || (minor === 24 && patch >= 4))))) {
    throw new Error('Managed stands require Compose >=2.24.4')
  }
  return { context, endpoint }
}
export function withDockerEngine(m, action) {
  return withPinnedEngine(m.engine, action, { prove: engine, run })
}
export function docker(m, args, options = {}) {
  return withDockerEngine(m, (execute) => execute(args, options))
}
export function composeArguments(m) {
  const args = [
    'compose',
    '--project-directory',
    m.snapshot,
    '--env-file',
    m.envFile,
    '-p',
    m.project,
    '--profile',
    'local-infra',
    '-f',
    `${m.snapshot}/docker-compose.yml`,
  ]
  // AMCORE_CONSOLE_HOST_OVERLAY_START
  if (m.topology === 'host')
    args.push('--profile', 'edge', '-f', `${m.snapshot}/docker/compose/console-host.yml`)
  // AMCORE_CONSOLE_HOST_OVERLAY_END
  return [...args, '-f', m.overlay]
}
export function compose(m, args, options = {}) {
  return docker(m, [...composeArguments(m), ...args], options)
}
export async function inspect(m, kind, id) {
  return JSON.parse(await docker(m, [kind, 'inspect', id], { capture: true }))[0]
}
