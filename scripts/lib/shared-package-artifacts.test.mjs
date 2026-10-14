import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyNativeConsumer } from './native-typecheck-shared.mjs'
import { verifyExports } from './shared-package-exports.mjs'
import { verifyConsumer, verifyMaps } from './shared-package-consumer.mjs'

import { root, copyShared, build } from './shared-package-fixture.mjs'

test(
  'packed shared contracts, clean removed module and nonzero build failure',
  { timeout: 180_000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'shared-artifacts-'))
    const consumer = mkdtempSync(join(tmpdir(), 'shared-consumer-'))
    try {
      copyShared(directory)
      build(directory)
      verifyMaps(directory)
      const values = verifyExports(root, directory)
      verifyConsumer(root, directory, consumer, values)
      verifyNativeConsumer(root, consumer)
      const index = join(directory, 'src/index.ts')
      const original = readFileSync(index)
      const removed = join(directory, 'src/removed-module.ts')
      writeFileSync(removed, 'export const removedModule = "removed-module-sentinel"\n')
      writeFileSync(
        index,
        Buffer.concat([original, Buffer.from('\nexport * from "./removed-module"\n')])
      )
      build(directory)
      assert.match(
        readFileSync(join(directory, 'dist/index.js'), 'utf8'),
        /removed-module-sentinel/
      )
      rmSync(removed)
      writeFileSync(index, original)
      writeFileSync(join(directory, 'dist/orphan.js'), 'stale')
      build(directory)
      assert.equal(existsSync(join(directory, 'dist/orphan.js')), false)
      for (const file of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts'])
        assert.doesNotMatch(
          readFileSync(join(directory, 'dist', file), 'utf8'),
          /removedModule|removed-module-sentinel/
        )
      writeFileSync(
        index,
        Buffer.concat([original, Buffer.from('\nexport * from "./missing-module"\n')])
      )
      assert.throws(
        () => build(directory),
        (error) => Number.isInteger(error.status) && error.status > 0
      )
      writeFileSync(index, original)
      build(directory)
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(consumer, { recursive: true, force: true })
    }
  }
)
