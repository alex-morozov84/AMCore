import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse, parseAllDocuments } from 'yaml'
import { createRegistryFixture } from './pnpm-registry-fixture.mjs'

const root = new URL('../../', import.meta.url)

for (const mismatch of [false, true])
  test(
    `registry identity ${mismatch ? 'mismatch refuses downloads and hooks' : 'positive control installs and runs allowed hook'}`,
    { timeout: 30000 },
    async () => {
      const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
      const workspace = parse(await readFile(new URL('pnpm-workspace.yaml', root), 'utf8'))
      const managers = parseAllDocuments(
        await readFile(new URL('pnpm-lock.yaml', root), 'utf8')
      ).filter((doc) => doc.toJS()?.importers?.['.']?.packageManagerDependencies?.pnpm)
      assert.equal(managers.length, 1, 'Require the real pinned manager document')
      const policy = Object.fromEntries(
        ['minimumReleaseAge', 'minimumReleaseAgeStrict', 'minimumReleaseAgeIgnoreMissingTime'].map(
          (key) => [key, workspace[key]]
        )
      )
      assert.deepEqual(policy, {
        minimumReleaseAge: 1440,
        minimumReleaseAgeStrict: true,
        minimumReleaseAgeIgnoreMissingTime: false,
      })
      const fixture = await createRegistryFixture({
        packageManager: manifest.packageManager,
        managerLock: managers[0].toString(),
        policy,
        mismatch,
      })
      try {
        const result = await fixture.run()
        assert.equal(result.signal, null, result.text)
        assert.ok(fixture.requests.includes('/amcore-registry-fixture'), result.text)
        if (mismatch) {
          assert.notEqual(result.code, 0, result.text)
          assert.match(result.text, /ERR_PNPM_REGISTRY_NAME_MISMATCH/)
          assert.equal(fixture.requests.includes('/fixture.tgz'), false)
          assert.equal(existsSync(fixture.marker), false)
          assert.equal(
            existsSync(`${fixture.directory}/node_modules/amcore-registry-fixture`),
            false
          )
        } else {
          assert.equal(result.code, 0, result.text)
          assert.ok(fixture.requests.includes('/fixture.tgz'), result.text)
          assert.equal(await readFile(fixture.marker, 'utf8'), 'installed')
        }
      } finally {
        await fixture.cleanup()
      }
    }
  )
