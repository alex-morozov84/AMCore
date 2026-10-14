import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import config from '../../packages/shared/tsdown.config.ts'

const hook = config.hooks['build:done']
const declaration = (name) => `export declare const ${name}: unknown;\n`
const mapped = (name) => `${declaration(name)}//# sourceMappingURL=missing.map\n`

for (const [owned, other] of [
  ['index.d.ts', 'index.d.cts'],
  ['index.d.cts', 'index.d.ts'],
]) {
  test(`DTS cleanup owns only emitted ${owned} and preserves ${other}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shared-map-cleanup-'))
    try {
      writeFileSync(join(directory, owned), mapped('owned'))
      writeFileSync(join(directory, other), mapped('freshOther'))
      const js = 'export const value = 1;\n//# sourceMappingURL=index.js.map\n'
      writeFileSync(join(directory, 'index.js'), js)
      await hook({
        options: { outDir: directory, format: owned.endsWith('.cts') ? 'cjs' : 'esm' },
        chunks: [
          { fileName: owned, outDir: directory },
          { fileName: 'index.js', outDir: directory },
        ],
      })
      assert.equal(readFileSync(join(directory, owned), 'utf8'), declaration('owned'))
      assert.equal(readFileSync(join(directory, other), 'utf8'), mapped('freshOther'))
      assert.equal(readFileSync(join(directory, 'index.js'), 'utf8'), js)
      await hook({
        options: { outDir: directory, format: owned.endsWith('.cts') ? 'cjs' : 'esm' },
        chunks: [{ fileName: owned, outDir: directory }],
      })
      assert.equal(readFileSync(join(directory, owned), 'utf8'), declaration('owned'))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('empty emitted set never rewrites another build declaration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shared-map-cleanup-'))
  try {
    const path = join(directory, 'index.d.cts')
    writeFileSync(path, mapped('newGeneration'))
    await hook({ options: { outDir: directory, format: 'esm' }, chunks: [] })
    assert.equal(readFileSync(path, 'utf8'), mapped('newGeneration'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
