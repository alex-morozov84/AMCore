// Explicit local Docker regression: node --test scripts/load-test/test/recover.live.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../recover.sh')
const composeBinary = process.env.T080_COMPOSE_BINARY
const docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim()
const call = (args, options = {}) =>
  execFileSync(docker, args, { encoding: 'utf8', ...options }).trim()

test(
  'Caddy-only recovery preserves a real marked PG volume, refuses unsafe inputs and resumes after interruption',
  { timeout: 120000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 't080-recover-'))
    const run = `c1${Date.now()}`
    const project = `amcore-loadtest-${run}`
    const env = { ...process.env, HOME: join(dir, 'home') }
    mkdirSync(env.HOME)
    symlinkSync(join(process.env.HOME, '.docker'), join(env.HOME, '.docker'))
    mkdirSync(join(dir, 'docker/compose'), { recursive: true })
    const base = {
      services: {
        postgres: {
          image: 'postgres:18-alpine',
          environment: { POSTGRES_PASSWORD: 'fixture-only' },
          volumes: ['postgres_data:/var/lib/postgresql'],
        },
        caddy: {
          image: 'caddy:2-alpine',
          command: ['caddy', 'file-server', '--listen', ':8080', '--root', '/srv'],
          ports: ['127.0.0.1::8080'],
          volumes: [
            'caddy_data:/data',
            'caddy_config:/config',
            `${dir}/index.html:/srv/index.html:ro`,
          ],
        },
      },
      volumes: { postgres_data: {}, caddy_data: {}, caddy_config: {} },
    }
    writeFileSync(join(dir, 'compose.json'), JSON.stringify(base))
    writeFileSync(join(dir, 'index.html'), 'normal-caddy-fixture')
    writeFileSync(
      join(dir, 'docker/compose/load-test.yml'),
      JSON.stringify({
        services: { caddy: { ports: ['127.0.0.1::8443'] } },
        volumes: { postgres_data: { labels: { 'amcore.load-test.run': run } } },
      })
    )
    const initialEnv = `COMPOSE_PROJECT_NAME=${project}\nLOAD_TEST_RUN_ID=${run}\nCOMPOSE_FILE=compose.json:docker/compose/load-test.yml\nFIXTURE_UNCHANGED=value\n`
    const compose = (...args) =>
      execFileSync(
        composeBinary || docker,
        [...(composeBinary ? [] : ['compose']), '--project-directory', dir, '-p', project, ...args],
        { cwd: dir, env, encoding: 'utf8' }
      ).trim()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const forward = composeBinary
      ? `if [ "$1" = compose ]; then shift; exec '${composeBinary}' "$@"; fi\n`
      : ''
    const ordinary = `#!/bin/sh\n${forward}exec '${docker}' "$@"\n`
    writeFileSync(join(bin, 'docker'), ordinary, { mode: 0o700 })
    env.PATH = `${bin}:${env.PATH}`
    const invoke = (extra = {}) =>
      spawnSync('sh', [script], {
        cwd: dir,
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 30000,
      })
    const inspect = (kind, id) => JSON.parse(call([kind, 'inspect', id]))[0]
    writeFileSync(join(dir, '.env'), initialEnv, { mode: 0o600 })
    try {
      compose('up', '-d')
      const pg = compose('ps', '-q', 'postgres')
      const volume = inspect('volume', `${project}_postgres_data`)
      assert.equal(volume.Labels['amcore.load-test.run'], run)
      const deadline = Date.now() + 30000
      while (
        spawnSync(docker, ['exec', pg, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' })
          .status !== 0
      ) {
        assert.ok(Date.now() < deadline, 'Postgres readiness deadline')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const sql = (query) => call(['exec', pg, 'psql', '-U', 'postgres', '-Atc', query])
      sql("CREATE TABLE proof (value text); INSERT INTO proof VALUES ('preserved-c1')")
      const preserved = () => {
        assert.equal(compose('ps', '-q', 'postgres'), pg)
        assert.equal(inspect('volume', volume.Name).CreatedAt, volume.CreatedAt)
        assert.equal(sql('SELECT value FROM proof'), 'preserved-c1')
      }
      // A missing edge volume refuses BEFORE rewriting .env or replacing any container.
      const caddy = compose('ps', '-q', 'caddy')
      compose('stop', 'caddy')
      compose('rm', '-f', 'caddy')
      call(['volume', 'rm', `${project}_caddy_config`])
      const refusal = invoke()
      assert.notEqual(refusal.status, 0)
      assert.match(refusal.stderr, /missing or foreign volume caddy_config/)
      assert.equal(readFileSync(join(dir, '.env'), 'utf8'), initialEnv)
      preserved()
      compose('up', '-d', '--no-deps', 'caddy')
      assert.notEqual(compose('ps', '-q', 'caddy'), caddy)
      // Interrupt immediately before up: old entry remains until an explicit safe retry.
      const wrapper = `#!/bin/sh\ncase " $* " in *" up "*) kill -TERM "$PPID"; exit 143;; esac\n${forward}exec '${docker}' "$@"\n`
      writeFileSync(join(dir, 'bin/docker'), wrapper, { mode: 0o700 })
      const interrupted = invoke({ PATH: `${dir}/bin:${env.PATH}` })
      assert.notEqual(interrupted.status, 0)
      preserved()
      const oldEntry = compose('port', 'caddy', '8443')
      assert.match(oldEntry, /127\.0\.0\.1:/)
      writeFileSync(join(bin, 'docker'), ordinary, { mode: 0o700 })
      for (let repeat = 0; repeat < 2; repeat++) {
        const result = invoke()
        assert.equal(result.status, 0, result.stderr)
        assert.doesNotMatch(result.stdout + result.stderr, /recreate.*volume|data will be lost/i)
        preserved()
        const edge = inspect('container', compose('ps', '-q', 'caddy'))
        assert.equal(edge.NetworkSettings.Ports['8443/tcp'], undefined)
        await assert.rejects(
          fetch(`http://${oldEntry}`),
          (error) => error.cause?.code === 'ECONNREFUSED'
        )
        const endpoint = compose('port', 'caddy', '8080')
        const response = await fetch(`http://${endpoint}`)
        assert.equal(await response.text(), 'normal-caddy-fixture')
      }
      assert.equal(
        readFileSync(join(dir, '.env'), 'utf8'),
        initialEnv.replace(':docker/compose/load-test.yml', '')
      )
    } finally {
      // Only the exact disposable fixture; no owner project or global prune.
      compose('down', '-v')
    }
  }
)
