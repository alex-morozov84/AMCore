import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyNativeConsumer } from './native-typecheck-shared.mjs'
import { verifyExports } from './shared-package-exports.mjs'
import { verifyConsumer, verifyMaps } from './shared-package-consumer.mjs'

import { root, copyShared, build } from './shared-package-fixture.mjs'

/** Every emitted file's text: the build mirrors source modules, not one bundle. */
function distText(directory) {
  const dist = join(directory, 'dist')
  return readdirSync(dist, { recursive: true })
    .filter((name) => /\.(?:js|cjs|d\.ts|d\.cts)$/.test(name))
    .map((name) => readFileSync(join(dist, name), 'utf8'))
    .join('\n')
}

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
      const mapPath = join(directory, 'dist/schemas/auth.js.map')
      const originalMap = readFileSync(mapPath, 'utf8')
      const map = JSON.parse(originalMap)
      const typescriptIndex = map.sources.findIndex((source) => source.endsWith('.ts'))
      assert.notEqual(typescriptIndex, -1)
      map.sourcesContent[typescriptIndex] = ''
      writeFileSync(mapPath, JSON.stringify(map))
      assert.throws(() => verifyMaps(directory))
      writeFileSync(mapPath, originalMap)
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
      assert.match(distText(directory), /removed-module-sentinel/)
      rmSync(removed)
      writeFileSync(index, original)
      writeFileSync(join(directory, 'dist/orphan.js'), 'stale')
      build(directory)
      assert.equal(existsSync(join(directory, 'dist/orphan.js')), false)
      assert.doesNotMatch(distText(directory), /removedModule|removed-module-sentinel/)
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
