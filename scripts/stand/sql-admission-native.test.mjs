import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { create } from './create.mjs'
import { configuration } from './config.mjs'
import { compose, docker, inspect } from './docker.mjs'
import { cleanup, discover, sql } from './ownership.mjs'
import { initializeMarker } from './bootstrap-marker.mjs'
import { admitInvocation, endInvocation } from './invocation.mjs'
import { fixtureInput, psqlArguments } from './local-sql.mjs'
import { supervise } from './supervisor.mjs'
import { allocateControlSocket } from './control-socket.mjs'
import { lease, save, directory } from './state.mjs'
import { run, cleanEnvironment, stopChildren } from './process.mjs'
import { fixtureAccounts } from './fixture-accounts.mjs'
import { DEMO_EMAILS, DEMO_PASSWORD } from './demo-credentials.mjs'
import {
  adminSql,
  fixtureCommand,
  waitForQuery,
  refusedWrite,
  redisCommand,
  fixtureGate,
} from './sql-admission-proof-helpers.mjs'

const poisoned = {
  DATABASE_URL: 'postgresql://foreign.invalid/owner',
  E2E_DATABASE_URL: 'postgresql://foreign.invalid/owner',
  DOCKER_HOST: 'tcp://foreign.invalid:2375',
  DOCKER_CONTEXT: 'foreign',
  PGHOST: 'foreign.invalid',
  PGPORT: '9999',
  PGDATABASE: 'owner',
  PGUSER: 'owner',
  PGSERVICE: 'owner',
  PGSERVICEFILE: '/foreign',
  PGOPTIONS: '-c search_path=foreign',
}

test('SQL admission contract native proof pack', async (t) => {
  const id = `sql-proof-${randomUUID()}`
  const held = await lease(id, 'sql-admission-proof')
  let m, close
  try {
    m = await create(id, 'e2e', 'path')
    await configuration(m)
    await save(m)
    await compose(m, ['up', '-d', '--wait', '--no-deps', 'postgres', 'redis'])
    await initializeMarker(m)
    await adminSql(
      m,
      `CREATE TABLE public.admission_probe(value int); INSERT INTO public.admission_probe VALUES(1);
      CREATE SCHEMA core; CREATE TABLE core.users(id text, "emailCanonical" text, "systemRole" text);
      INSERT INTO core.users VALUES('unrecorded', '${DEMO_EMAILS.USER}', 'USER');`
    )
    m.runToken = held.token
    m.controlSocket = await allocateControlSocket()
    await save(m)
    await admitInvocation(m)
    close = await supervise(m, held.token)

    await t.test(
      'local SQL preserves SELECT, ID, UPDATE1 and quoted parameter output',
      async () => {
        const timings = []
        for (let i = 0; i < 3; i++) {
          const start = Date.now()
          assert.equal((await fixtureCommand(m, 'SELECT 42;')).trim(), '42')
          timings.push(Date.now() - start)
        }
        await writeFile(
          `${directory(id)}/sql-proof-timing.json`,
          JSON.stringify({ id, milliseconds: timings })
        )
        assert.equal((await fixtureCommand(m, 'SELECT id FROM core.users;')).trim(), 'unrecorded')
        assert.equal(
          (await fixtureCommand(m, 'UPDATE public.admission_probe SET value = 1;')).trim(),
          'UPDATE 1'
        )
        assert.equal(
          (await fixtureCommand(m, "SELECT :'value';", { value: "O'Reilly" })).trim(),
          "O'Reilly"
        )
      }
    )
    await t.test(
      'poisoned host and container connection defaults cannot retarget SQL',
      async () => {
        assert.equal(
          (await fixtureCommand(m, 'SELECT current_database();', {}, poisoned)).trim(),
          'amcore'
        )
        const args = psqlArguments(m)
        args.splice(
          1,
          0,
          ...Object.entries(poisoned).flatMap(([key, value]) => ['-e', `${key}=${value}`])
        )
        assert.equal(
          (
            await run('docker', ['--host', m.engine.endpoint, ...args], {
              capture: true,
              input: fixtureInput(m, 'SELECT inet_server_addr() IS NULL;'),
              env: cleanEnvironment(),
            })
          ).trim(),
          't'
        )
      }
    )
    await t.test('Redis remains local and refuses caller transport overrides', async () => {
      assert.equal((await redisCommand(m, ['PING'], poisoned)).trim(), 'PONG')
      for (const option of [
        '--host=foreign.invalid',
        '-hforeign.invalid',
        '-s',
        '--uri=redis://foreign.invalid',
      ])
        await assert.rejects(() => redisCommand(m, [option, 'PING']), /transport/)
    })
    await t.test('caller transaction control and reconnect refuse before mutation', async () => {
      for (const query of [
        'COMMIT; UPDATE public.admission_probe SET value=99;',
        'ROLLBACK;',
        'BEGIN;',
        'END;',
        '\\connect owner',
        'SET SESSION AUTHORIZATION owner;',
      ])
        await assert.rejects(() => fixtureCommand(m, query))
      assert.equal((await adminSql(m, 'SELECT value FROM public.admission_probe;')).trim(), '1')
      await assert.rejects(() => sql(m, 'SELECT 1;', false), /variables/)
    })
    await t.test(
      'wrong lease, altered proof and preview purpose refuse without adoption',
      async () => {
        const ownerPath = `${directory(id)}/lease/owner.json`
        const original = await readFile(ownerPath)
        try {
          const owner = JSON.parse(original)
          owner.token = randomUUID()
          await writeFile(ownerPath, JSON.stringify(owner))
          await refusedWrite(m)
        } finally {
          await writeFile(ownerPath, original)
        }
        for (const field of ['postgres', 'purpose']) {
          const originalValue = m[field]
          try {
            m[field] = field === 'postgres' ? '0'.repeat(64) : 'preview'
            await save(m)
            await refusedWrite({
              ...m,
              postgres: field === 'postgres' ? originalValue : m.postgres,
            })
          } finally {
            m[field] = originalValue
            await save(m)
          }
        }
        await assert.rejects(() => sql({ ...m }, 'SELECT 1;'), /Invocation/)
      }
    )
    await t.test(
      'own account ID and credential guards reject unrecorded adoption/reset',
      async () => {
        m.accounts = [
          { email: DEMO_EMAILS.USER, password: DEMO_PASSWORD, role: 'USER', pending: true },
        ]
        await assert.rejects(
          () =>
            fixtureAccounts(
              m,
              {
                post: () => {
                  throw Error('API must not run')
                },
              },
              'user'
            ),
          /Unrecorded/
        )
        m.accounts[0].password = 'changed'
        await assert.rejects(() => fixtureAccounts(m, {}, 'user'), /credential/)
        assert.equal((await adminSql(m, 'SELECT "systemRole" FROM core.users;')).trim(), 'USER')
        delete m.accounts
      }
    )
    await t.test('missing and previously changed marker refuse before fixture writes', async () => {
      await adminSql(m, 'DELETE FROM stand_meta.identity;')
      await refusedWrite(m, /query returned no rows|identity/)
      await adminSql(m, "INSERT INTO stand_meta.identity VALUES ('wrong-marker');")
      await refusedWrite(m, /DB marker mismatch/)
      await adminSql(m, `UPDATE stand_meta.identity SET uuid='${m.uuid}';`)
    })
    await t.test(
      'later marker change waits for compatible marker lock and valid fixture commits',
      async () => {
        const releaseGate = await fixtureGate(m)
        const fixture = fixtureCommand(
          m,
          'SELECT pg_advisory_xact_lock(0); UPDATE public.admission_probe SET value=2;'
        )
        const settledFixture = fixture.catch((error) => error)
        let update
        try {
          await waitForQuery(
            m,
            "wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock(0)%'"
          )
          update = adminSql(m, "UPDATE stand_meta.identity SET uuid='wrong-marker';")
          const settledUpdate = update.catch((error) => error)
          await waitForQuery(
            m,
            "wait_event_type='Lock' AND query LIKE 'UPDATE stand_meta.identity%'"
          )
          await releaseGate()
          const output = await settledFixture
          assert.equal(typeof output, 'string')
          assert.match(output, /UPDATE 1/)
          assert.equal(typeof (await settledUpdate), 'string')
          assert.equal((await adminSql(m, 'SELECT value FROM public.admission_probe;')).trim(), '2')
        } finally {
          await releaseGate()
          await settledFixture
          if (update) await update.catch(() => {})
          await adminSql(
            m,
            `UPDATE stand_meta.identity SET uuid='${m.uuid}'; UPDATE public.admission_probe SET value=1;`
          )
        }
      }
    )
    await t.test(
      'missing live supervisor refuses and a new scope requires full admission',
      async () => {
        await close()
        close = undefined
        await assert.rejects(
          () => fixtureCommand(m, 'UPDATE public.admission_probe SET value=99;'),
          /ENOENT|supervisor|unavailable/
        )
        m.controlSocket = await allocateControlSocket()
        await save(m)
        await admitInvocation(m)
        close = await supervise(m, held.token)
        assert.equal(
          (await fixtureCommand(m, 'SELECT value FROM public.admission_probe;')).trim(),
          '1'
        )
      }
    )
    await t.test(
      'missing exact container and recreated container cannot be silently adopted',
      async () => {
        const original = m.postgres
        await docker(m, ['container', 'rm', '-f', original])
        await assert.rejects(() => fixtureCommand(m, 'UPDATE public.admission_probe SET value=99;'))
        await compose(m, ['up', '-d', '--wait', '--no-deps', 'postgres'])
        await assert.rejects(() => fixtureCommand(m, 'UPDATE public.admission_probe SET value=99;'))
        const resources = await discover(m, false)
        for (const id of resources.container) {
          const item = await inspect(m, 'container', id)
          if (item.Config.Labels['com.docker.compose.service'] === 'postgres') {
            assert.notEqual(id, original)
            assert.equal(
              (
                await adminSql({ ...m, postgres: id }, 'SELECT value FROM public.admission_probe;')
              ).trim(),
              '1'
            )
            await docker(m, ['container', 'stop', id])
          }
        }
      }
    )
  } finally {
    if (close) await close()
    if (m) {
      endInvocation(m)
      delete m.runToken
      delete m.controlSocket
    }
    await stopChildren()
    if (m) {
      await cleanup(m, true)
      assert.deepEqual(await discover(m, false), { container: [], network: [], volume: [] })
    }
    await held.release()
  }
})
