import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'
import { root } from './shared-package-fixture.mjs'

test(
  'actual prepare rejects stale outputs and failed rebuild, then recovers',
  { timeout: 90000 },
  async () => {
    const copy = createWorkingTreeCopy(root)
    const previous = process.env.pnpm_config_verify_deps_before_run
    // The copy intentionally links tested tools; never install into their targets.
    process.env.pnpm_config_verify_deps_before_run = 'false'
    try {
      for (const name of ['', 'apps/api', 'packages/shared', 'packages/typescript-config'])
        symlinkSync(join(root, name, 'node_modules'), join(copy.root, name, 'node_modules'))
      const { prepare, preflight } = await import(
        pathToFileURL(join(copy.root, 'scripts/api-e2e/prepare.mjs'))
      )
      prepare()
      preflight()
      for (const name of [
        'packages/shared/tsconfig.json',
        'packages/shared/tsdown.config.ts',
        'apps/api/package.json',
        'pnpm-lock.yaml',
      ]) {
        const path = join(copy.root, name),
          original = readFileSync(path)
        writeFileSync(path, Buffer.concat([original, Buffer.from('\n')]))
        assert.throws(preflight, /--prepare/)
        writeFileSync(path, original)
        preflight()
      }
      const { inputHash, executionHash } = await import(
        pathToFileURL(join(copy.root, 'scripts/api-e2e/paths.mjs'))
      )
      const preparationHash = inputHash(),
        execution = executionHash()
      writeFileSync(join(copy.root, 'apps/api/test/native-execution-proof.ts'), 'export {}\n')
      assert.equal(inputHash(), preparationHash)
      assert.notEqual(executionHash(), execution)
      preflight()
      const output = join(copy.root, 'packages/shared/dist/index.js')
      const originalOutput = readFileSync(output)
      writeFileSync(output, 'stale')
      assert.throws(preflight, /--prepare/)
      writeFileSync(output, originalOutput)
      preflight()
      const index = join(copy.root, 'packages/shared/src/index.ts')
      const original = readFileSync(index)
      writeFileSync(
        index,
        Buffer.concat([original, Buffer.from('\nexport * from "./missing-native-contract"\n')])
      )
      assert.throws(preflight, /--prepare/)
      assert.throws(prepare, (error) => error.status > 0)
      assert.throws(preflight, /--prepare/)
      writeFileSync(index, original)
      rmSync(join(copy.root, 'packages/shared/dist'), { recursive: true, force: true })
      assert.throws(preflight, /--prepare/)
      prepare()
      preflight()
    } finally {
      if (previous === undefined) delete process.env.pnpm_config_verify_deps_before_run
      else process.env.pnpm_config_verify_deps_before_run = previous
      copy.cleanup()
    }
  }
)
