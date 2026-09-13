import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { commit, runInitProject } from './lib/init-project-test-helpers.mjs'

const root = process.cwd()
const project = `amcore-console-single-${process.pid}`
const nginx = `${project}-nginx`
const workspace = await mkdtemp(join(tmpdir(), 'amcore-console-single-'))
const ignored = new Set(['.env', '.git', '.next', 'node_modules', 'playwright-report'])
const environment = {
  ...process.env,
  ADMIN_CONSOLE_HOSTNAME: 'console.localhost',
  CADDY_DOMAIN: 'api.localhost',
  CADDY_WEB_DOMAIN: 'app.localhost',
}
const compose = [
  'compose', '-p', project, '--profile', 'local-infra', '--profile', 'edge',
  '-f', 'docker-compose.yml', '-f', 'docker-compose.console-host.yml',
  '-f', 'docker-compose.console-session-e2e.yml', '-f', 'docker-compose.single-locale-smoke.yml',
]

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: workspace, env: environment, stdio: 'inherit', ...options })
}

function request(port, pathname, body) {
  const status = execFileSync('curl', [
    '--silent', '--show-error', '--insecure', '--noproxy', '*',
    '--resolve', `console.localhost:${port}:127.0.0.1`, '--output', body,
    '--write-out', '%{http_code}', `https://console.localhost:${port}${pathname}`,
  ], { encoding: 'utf8' })
  return Number(status)
}

async function configureFixture() {
  await cp(root, workspace, {
    recursive: true,
    filter: (source) => source !== join(root, 'ai') && !ignored.has(basename(source)),
  })
  commit(workspace)
  const result = runInitProject(workspace, [
    '--mode=single', '--locale=en', '--admin-console=host', '--admin-console-slug=panel', '--yes',
  ])
  assert.equal(result.status, 0, result.stderr)
  const config = join(workspace, 'docker/nginx/operations-console.conf')
  const source = await readFile(config, 'utf8')
  await writeFile(config, source.replaceAll('console.example.com', 'console.localhost'))
  await writeFile(join(workspace, 'docker-compose.single-locale-smoke.yml'), `services:
  postgres:
    ports: !override []
  redis:
    ports: !override []
  api:
    ports: !override []
  web:
    ports: !override []
  caddy:
    ports: !override
      - '18444:443'
`)
  await mkdir(join(workspace, 'docker/nginx/tls'))
  run('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1',
    '-keyout', 'docker/nginx/tls/privkey.pem', '-out', 'docker/nginx/tls/fullchain.pem',
    '-subj', '/CN=console.localhost',
  ], { stdio: 'ignore' })
}

async function assertProxy(port, label) {
  for (const pathname of ['/sw.js', '/icons/icon-192x192.png', '/logo-dark.png']) {
    const body = join(workspace, `.smoke-${label}-${basename(pathname)}`)
    assert.equal(request(port, pathname, body), 200, `${label} must preserve ${pathname}`)
  }
  const rootBody = join(workspace, `.smoke-${label}-root`)
  assert.equal(request(port, '/', rootBody), 404, `${label} must map / to the protected console`)
  assert.doesNotMatch(await readFile(rootBody, 'utf8'), /nginx/i)
  const loginBody = join(workspace, `.smoke-${label}-login`)
  assert.equal(request(port, '/login', loginBody), 200, `${label} must map /login to console`)
  assert.match(await readFile(loginBody, 'utf8'), /Console sign in/)
  assert.equal(request(port, '/panel', join(workspace, `.smoke-${label}-physical`)), 404)
  assert.equal(request(port, '/api/access', join(workspace, `.smoke-${label}-api`)), 401)
}

try {
  await configureFixture()
  run('docker', [...compose, 'config', '-q'])
  run('docker', [...compose, 'up', '--build', '--wait', '--wait-timeout', '300'], { stdio: 'ignore' })
  run('docker', [...compose, 'exec', '-T', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
  await assertProxy(18444, 'caddy')
  run('docker', [
    'run', '--rm', '--network', `${project}_default`,
    '-v', `${join(workspace, 'docker/nginx/operations-console.conf')}:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${join(workspace, 'docker/nginx/tls')}:/etc/nginx/tls:ro`, 'nginx:1.27-alpine', 'nginx', '-t',
  ])
  run('docker', [
    'run', '-d', '--rm', '--name', nginx, '--network', `${project}_default`, '-p', '18443:443',
    '-v', `${join(workspace, 'docker/nginx/operations-console.conf')}:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${join(workspace, 'docker/nginx/tls')}:/etc/nginx/tls:ro`, 'nginx:1.27-alpine',
  ])
  run('docker', ['exec', nginx, 'nginx', '-t'])
  await assertProxy(18443, 'nginx')
  console.log('single-locale host proxy smoke: passed (Caddy and nginx)')
} finally {
  spawnSync('docker', ['rm', '-f', nginx], { stdio: 'ignore' })
  spawnSync('docker', [...compose, 'down', '--volumes', '--remove-orphans'], { cwd: workspace, env: environment, stdio: 'inherit' })
  await rm(workspace, { recursive: true, force: true })
}
