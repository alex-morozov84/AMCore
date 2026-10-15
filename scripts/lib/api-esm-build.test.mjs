import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const root = resolve(import.meta.dirname, '../..')

test(
  'API build cache tracks native/config inputs and refuses failed native checks',
  { timeout: 60_000 },
  () => {
    const copy = createWorkingTreeCopy(root)
    try {
      for (const name of ['', 'apps/api', 'packages/shared', 'packages/typescript-config']) {
        symlinkSync(join(root, name, 'node_modules'), join(copy.root, name, 'node_modules'))
      }
      execFileSync('git', ['init', '-q'], { cwd: copy.root })
      const files = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: root }
      )
      execFileSync('git', ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        cwd: copy.root,
        input: files,
      })
      const hash = () => {
        const output = execFileSync(
          join(root, 'node_modules/.bin/turbo'),
          ['run', 'build', '--filter=@amcore/api', '--dry=json'],
          { cwd: copy.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        )
        return JSON.parse(output).tasks.find((task) => task.taskId === '@amcore/api#build').hash
      }
      const initial = hash()
      for (const file of [
        'scripts/typecheck-native.mjs',
        'packages/typescript-config/nestjs.json',
        'apps/api/.swcrc',
        'apps/api/src/cli/storage-check.ts',
      ]) {
        const path = join(copy.root, file),
          original = readFileSync(path)
        writeFileSync(path, Buffer.concat([original, Buffer.from('\n')]))
        assert.notEqual(hash(), initial, file)
        writeFileSync(path, original)
        assert.equal(hash(), initial)
      }
      const api = join(copy.root, 'apps/api')
      mkdirSync(join(api, 'dist'), { recursive: true })
      writeFileSync(join(api, 'dist/build-identity.json'), 'sentinel')
      writeFileSync(
        join(api, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'NotAModule' },
          files: [],
        })
      )
      const failed = spawnSync('pnpm', ['run', 'build'], {
        cwd: api,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
      })
      assert.equal(failed.error, undefined)
      assert.notEqual(failed.status, 0)
      assert.match(failed.stdout + failed.stderr, /TS6046/)
      assert.equal(readFileSync(join(api, 'dist/build-identity.json'), 'utf8'), 'sentinel')
      assert.equal(existsSync(join(api, 'dist/main.js')), false)
    } finally {
      copy.cleanup()
    }
  }
)
