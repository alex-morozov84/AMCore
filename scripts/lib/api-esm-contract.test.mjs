import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const json = (path) => JSON.parse(read(path))

test('ESM package uses maintained Nest/SWC and strict native-before-emit sequencing', () => {
  const api = json('apps/api/package.json')
  assert.equal(api.type, 'module')
  assert.equal(api.scripts.dev, 'nest start --watch')
  assert.equal(
    api.scripts.build,
    'pnpm run typecheck && nest build -p tsconfig.build.json && node scripts/build-identity.mjs'
  )
  const cli = json('apps/api/nest-cli.json').compilerOptions
  assert.equal(cli.builder.type, 'swc')
  assert.deepEqual(cli.builder.options.extensions, ['.ts', '.tsx'])
  assert.equal(cli.typeCheck, true)
  assert.equal(cli.deleteOutDir, true)
  assert.equal(json('apps/api/.swcrc').module.type, 'es6')
  assert.equal(json('apps/api/.swcrc').module.resolveFully, true)
  assert.match(read('apps/api/prisma/schema.prisma'), /moduleFormat\s*=\s*"esm"/)
  assert.match(read('apps/api/prisma/schema.prisma'), /importFileExtension\s*=\s*"js"/)
})

test('build cache and Docker include the native check while preserving test inputs', () => {
  const tasks = json('turbo.json').tasks
  assert.ok(tasks.build.inputs.includes('$TURBO_DEFAULT$'))
  for (const file of ['scripts/typecheck-native.mjs', 'packages/typescript-config/**']) {
    assert.ok(tasks.build.inputs.includes('$TURBO_ROOT$/' + file))
  }
  assert.ok(tasks.test.inputs.includes('$TURBO_ROOT$/scripts/typecheck-native.mjs'))
  assert.match(
    read('apps/api/Dockerfile'),
    /COPY scripts\/typecheck-native\.mjs \.\/scripts\/typecheck-native\.mjs/
  )
})

test('Jest configs load through ESM and retain relative extension and decorator contracts', async () => {
  const require = createRequire(resolve(root, 'apps/api/package.json'))
  const swc = require('./jest-swc.config.cjs')
  for (const name of ['jest.config.js', 'jest-e2e.config.js']) {
    const { default: config } = await import(new URL('../../apps/api/' + name, import.meta.url))
    assert.equal(config.moduleNameMapper['^(\\.{1,2}/.*)\\.js$'], '$1')
    assert.ok(config.transform['^.+\\.tsx?$'])
  }
  assert.equal(swc().module.type, 'commonjs')
  assert.equal(swc(true).module.type, 'es6')
  assert.equal(swc(true).jsc.transform.decoratorMetadata, true)
})
