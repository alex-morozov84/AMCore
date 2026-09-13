import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const root = process.cwd()
const project = `amcore-console-e2e-${process.pid}`
const workspace = await mkdtemp(join(tmpdir(), 'amcore-console-e2e-'))
const ignored = new Set(['.env', '.git', '.next', 'node_modules', 'playwright-report'])
const environment = {
  ...process.env,
  ADMIN_CONSOLE_HOSTNAME: 'console.localhost',
  CADDY_DOMAIN: 'api.localhost',
  CADDY_WEB_DOMAIN: 'app.localhost',
}
const compose = [
  'compose',
  '-p',
  project,
  '--profile',
  'local-infra',
  '--profile',
  'edge',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.console-host.yml',
  '-f',
  'docker-compose.console-session-e2e.yml',
]

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: workspace, env: environment, stdio: 'inherit', ...options })
}

async function configureHostMode() {
  const file = join(workspace, 'apps/web/src/shared/lib/admin-console.generated.ts')
  const source = await readFile(file, 'utf8')
  const next = source.replace("mode: 'path'", "mode: 'host'")
  if (next === source) throw new Error('Expected generated console path-mode configuration')
  await writeFile(file, next)
}

try {
  await cp(root, workspace, {
    recursive: true,
    filter: (source) => source !== join(root, 'ai') && !ignored.has(basename(source)),
  })
  await configureHostMode()
  run('docker', [...compose, 'up', '--build', '--wait'])
  execFileSync('pnpm', ['--filter', 'web', 'test:e2e:console-real-stack'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...environment, CONSOLE_E2E_PROJECT: project },
  })
} finally {
  try {
    run('docker', [
      ...compose,
      'down',
      '--volumes',
      '--remove-orphans',
    ])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}
