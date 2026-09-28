import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { snapshot } from './snapshot.mjs'
import { root } from './state.mjs'
import { run, children, stopChildren, cleanEnvironment } from './process.mjs'
import { discover } from './ownership.mjs'
import { assertNoSurvivors } from './survivors.mjs'
import { processTable } from './process-groups.mjs'
import { commit } from '../lib/init-project-test-helpers.mjs'

for (const script of ['run-console-session-e2e.mjs', 'run-console-single-locale-proxy-smoke.mjs'])
  for (const signal of ['SIGINT', 'SIGTERM'])
    test(`public ${script} forwards ${signal}, waits for runner cleanup and preserves foreign process`, async () => {
      const home = await mkdtemp(join(tmpdir(), 'amcore-wrapper-proof-'))
      const source = join(home, 'source')
      const tmp = join(home, 'tmp')
      await mkdir(tmp)
      await snapshot(root, source)
      commit(source)
      await symlink(`${root}/node_modules`, `${source}/node_modules`)
      const foreign = spawn(
        process.execPath,
        ['-e', `process.title=${JSON.stringify(home)}; setInterval(() => {},1000)`],
        {
          detached: true,
          stdio: 'ignore',
          cwd: home,
        }
      )
      await writeFile(
        `${home}/sentinel.json`,
        JSON.stringify(processTable().find((row) => row.pid === foreign.pid)),
        { mode: 0o600 }
      )
      let completed = false
      const running = run(process.execPath, [`scripts/${script}`], {
        cwd: source,
        env: cleanEnvironment({ TMPDIR: tmp }),
      })
        .then(
          () => undefined,
          (error) => error
        )
        .finally(() => {
          completed = true
        })
      const wrapper = [...children].find((child) => child.standCwd === source)
      let m,
        verified = false
      try {
        const deadline = Date.now() + 240_000
        while (Date.now() < deadline && !completed) {
          const roots = [
            source,
            ...(await readdir(tmp))
              .filter((name) => name.startsWith('amcore-console-single-'))
              .map((name) => join(tmp, name)),
          ]
          for (const candidate of roots) {
            const base = `${candidate}/.amcore/stands`
            for (const id of await readdir(base).catch(() => [])) {
              const current = await readFile(`${base}/${id}/manifest.json`, 'utf8').then(
                JSON.parse,
                () => undefined
              )
              if (current?.state === 'configured' || current?.state === 'infrastructure-ready')
                m = current
            }
          }
          if (m) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.ok(m, 'wrapper did not reach owned configuration')
        const resourcesDeadline = Date.now() + 30_000
        while ((await discover(m, false)).container.length < 2 && Date.now() < resourcesDeadline)
          await new Promise((resolve) => setTimeout(resolve, 50))
        assert.ok(
          (await discover(m, false)).container.length >= 2,
          'owned partial infrastructure not created'
        )
        // Address the public wrapper itself, not stand.mjs or its detached group.
        process.kill(wrapper.pid, signal)
        const result = await running
        assert.match(result?.message ?? '', signal === 'SIGINT' ? /130/ : /143/)
        process.kill(foreign.pid, 0)
        assert.deepEqual(await discover(m, false), { container: [], network: [], volume: [] })
        await assertNoSurvivors(m)
        for (const id of await readdir(`${source}/.amcore/stands`)) {
          if (!id.startsWith('wrapper-')) continue
          const record = JSON.parse(
            await readFile(`${source}/.amcore/stands/${id}/manifest.json`, 'utf8')
          )
          if (!record.wrapper) continue
          assert.equal(record.state, 'purged')
          assert.ok(record.closeout.verifiedAt)
          await assert.rejects(
            () => readFile(`${source}/.amcore/stands/${id}/lease/children.json`),
            { code: 'ENOENT' }
          )
        }
        if (script === 'run-console-session-e2e.mjs') {
          const final = JSON.parse(
            await readFile(`${m.worktree}/.amcore/stands/${m.id}/manifest.json`, 'utf8')
          )
          assert.equal(final.state, 'purged')
          await assert.rejects(
            () => readFile(`${m.worktree}/.amcore/stands/${m.id}/lease/owner.json`),
            { code: 'ENOENT' }
          )
        } else
          await assert.rejects(() => readFile(`${m.worktree}/package.json`), { code: 'ENOENT' })
        verified = true
      } finally {
        foreign.kill('SIGKILL')
        await once(foreign, 'close')
        await stopChildren()
        await running
        if (verified) await rm(home, { recursive: true })
        else console.error(`Wrapper proof incomplete; preserve owned source/recovery: ${home}`)
      }
    })
