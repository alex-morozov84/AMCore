// Test doubles for the load-test shell scripts: a temporary checkout-like directory with
// stub docker, ssh, vmstat, timeout and date on PATH. Docker volume mounts are mapped back
// to host paths, so the real report tools (node) run on the files the scripts wrote.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const DOCKER = `#!/usr/bin/env node
// Stub docker: behaviour from stub.json beside bin/ (lt_compose clears the environment).
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "stub.json"), "utf8"))
const log = (line) => fs.appendFileSync(cfg.log, line + '\\n')
log(args.join(' '))
const now = () => Date.now() / 1000
if (args[0] === 'volume') return console.log(cfg.volumeLabel ?? '')
if (args[0] === 'compose') {
  const sub = args.find((a) => ['ps', 'exec', 'cp', 'config', 'up', 'run', 'port', 'build'].includes(a))
  if (sub === 'run') log('compose-run-env COMPOSE_PROJECT_NAME=' + (process.env.COMPOSE_PROJECT_NAME ?? ''))
  if (sub === 'config') return console.log(JSON.stringify(cfg.config ?? {}))
  if (sub === 'ps') return console.log(args.includes('postgres') ? 'pg1' : 'id-api\\nid-web')
  if (sub === 'exec') {
    // server-stats.sh logs: a tar stream of the test-entry access log for this step.
    const routes = (cfg.routes || '').split(',')
    const t = Number(fs.readFileSync(cfg.windowStart, 'utf8'))
    const lines = routes.map((uri, i) => JSON.stringify({ ts: t + 0.5 + i * 0.01, duration: 0.02, status: 200, request: { uri, tls: { client_common_name: 'k6' } } }))
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lt-caddy-'))
    fs.writeFileSync(path.join(dir, 'load-test-access.log'), lines.join('\\n') + '\\n')
    const tar = spawnSync('tar', ['cf', '-', '-C', dir, 'load-test-access.log'])
    process.stdout.write(tar.stdout)
    return
  }
  return
}
if (args[0] === 'inspect' && args[1] === 'pg1') return console.log(JSON.stringify(cfg.inspect ?? []))
if (args[0] === 'inspect') return console.log('api id-api 0 false\\nweb id-web 0 false')
if (args[0] === 'stats') {
  if (cfg.stats === 'fail') process.exit(1)
  if (cfg.stats === 'hang') spawnSync('sleep', ['15']) // longer than the sampler limit, short enough not to linger
  return console.log('api 100MiB / 2GiB 1%\\nweb 90MiB / 2GiB 1%')
}
if (args[0] === 'run') {
  const mounts = []
  let i = 1
  const rest = []
  while (i < args.length) {
    if (args[i] === '-v') { const [src, dst] = args[i + 1].split(':'); mounts.push([dst, src]); i += 2; continue }
    if (['--user', '-e', '--network', '-w'].includes(args[i])) { i += 2; continue }
    if (args[i].startsWith('-')) { i += 1; continue }
    rest.push(...args.slice(i)); break
  }
  // One pass over all mount targets, so a replaced host path is never rewritten again.
  const re = new RegExp('(' + mounts.map(([dst]) => dst).join('|') + ')(?=/|\\\\s|$)', 'g')
  const map = (s) => (mounts.length ? s.replace(re, (dst) => mounts.find(([d]) => d === dst)[1]) : s)
  const [image, ...cmd] = rest
  if (image.startsWith('grafana/k6')) {
    const env = Object.fromEntries(cmd.flatMap((a, j) => (cmd[j - 1] === '-e' ? [a.split(/=(.*)/s).slice(0, 2)] : [])))
    const out = map('/work/' + (env.LT_SMOKE === '1' ? 'out-smoke' : 'out'))
    if (cmd.some((a) => a.endsWith('prepare.js'))) return
    const start = now()
    fs.writeFileSync(cfg.windowStart, String(start))
    spawnSync('sleep', [String(cfg.k6Seconds || 3)])
    if (cfg.k6 === 'fail') process.exit(107)
    const n = (cfg.routes || '').split(',').length
    const m = (count) => ({ values: { count } })
    const names = ['bff_me', 'bff_orgs', 'bff_context', 'ssr_sessions', 'bff_members', 'ssr_login', 'bff_profile', 'bff_unread', 'bff_avatar', 'admin_users', 'admin_audit']
    const checks = names.map((name) => ({ name, passes: 1, fails: 0 }))
    const summary = { root_group: { checks }, metrics: {
      'iterations{scenario:site}': m(6), 'iterations{scenario:admin}': m(1),
      'http_reqs{scenario:site}': m(n - 2), 'http_reqs{scenario:admin}': m(2),
      'http_req_failed{scenario:site}': { values: { rate: 0 } }, 'http_req_failed{scenario:admin}': { values: { rate: 0 } },
      http_reqs: m(n + 1), vus_max: { values: { value: 1 } } } }
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, env.LT_STEP + '.summary.json'), JSON.stringify(summary))
    fs.writeFileSync(path.join(out, env.LT_STEP + '.window.json'), JSON.stringify({ start, end: start + Number(cfg.k6Seconds || 3), rate: Number(env.LT_RATE), smoke: env.LT_SMOKE === '1' }))
    return
  }
  if (cfg.nodeRunExit) process.exit(cfg.nodeRunExit) // e.g. 125: the image could not be pulled
  const mapped = cmd.map(map)
  const r = spawnSync(mapped[0], mapped.slice(1), { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
`

const SCRIPTS = {
  // Remote commands run locally: the last argument is the command line. STUB_SSH_DELAY
  // models a slow connection setup before the remote command starts.
  ssh: '#!/bin/sh\nsleep "${STUB_SSH_DELAY:-0}"\nfor last in "$@"; do :; done\nexec sh -c "$last"\n',
  timeout: '#!/bin/sh\nshift\nexec "$@"\n',
  vmstat:
    '#!/bin/sh\necho "procs ---memory---"\necho " r b swpd free buff cache si so bi bo in cs us sy id wa st"\necho " 0 0 0 1 1 1 0 0 0 0 1 1 5 5 90 0 0"\n',
  // GNU date's %3N (milliseconds) is missing on some systems; tests need only that form.
  date: '#!/bin/sh\nif [ "${1:-}" = "+%s%3N" ]; then node -e "console.log(Date.now())"; else exec /bin/date "$@"; fi\n',
  nproc: '#!/bin/sh\necho 2\n',
}

export function stubWorld() {
  const d = mkdtempSync(join(tmpdir(), 'lt-runner-'))
  const bin = join(d, 'bin')
  mkdirSync(bin)
  for (const [name, body] of Object.entries({ ...SCRIPTS, docker: DOCKER })) {
    writeFileSync(join(bin, name), body)
    chmodSync(join(bin, name), 0o755)
  }
  const work = join(d, 'work')
  mkdirSync(work)
  writeFileSync(join(work, 'fixture-password'), 'Lt0123456789abcdef9')
  writeFileSync(join(d, 'meminfo'), 'MemTotal: 2048000 kB\nMemAvailable: 512000 kB\n')
  const envFile = join(d, 'load-test.env')
  writeFileSync(
    envFile,
    [
      `LT_WORK=${work}`,
      'LT_SERVER_SSH=stub',
      `LT_SERVER_DIR=${ROOT}`,
      'LT_WEB_HOST=app.example.test',
      'LT_API_HOST=api.example.test',
      'LT_SERVER_IP=127.0.0.1',
      'LT_PREFIX=/en',
    ].join('\n') + '\n'
  )
  const stub = (options = {}) =>
    writeFileSync(
      join(d, 'stub.json'),
      JSON.stringify({
        log: join(d, 'docker.log'),
        windowStart: join(d, 'window-start'),
        ...options,
      })
    )
  stub()
  const env = (extra = {}) => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: d,
    LT_ENV: envFile,
    LT_MEMINFO: join(d, 'meminfo'),
    LT_SAMPLE_INTERVAL: '1',
    ...extra,
  })
  return { dir: d, work, env, stub }
}
