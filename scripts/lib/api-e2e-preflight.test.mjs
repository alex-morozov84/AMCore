import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root } from '../api-e2e/paths.mjs'

test('fresh-job receipt refuses missing, stale and changed generated outputs before execution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-e2e-admission-'))
  try {
    for (const name of [
      'scripts/api-e2e',
      'apps/api/prisma',
      'apps/api/src/generated/prisma',
      'packages/shared/src',
      'packages/shared/dist',
      '.amcore',
    ])
      mkdirSync(join(directory, name), { recursive: true })
    for (const name of ['paths.mjs', 'prepare.mjs'])
      cpSync(join(root, 'scripts/api-e2e', name), join(directory, 'scripts/api-e2e', name))
    for (const name of [
      'package.json',
      'pnpm-lock.yaml',
      'apps/api/package.json',
      'apps/api/jest-e2e.config.js',
      'apps/api/jest-swc.config.cjs',
      'apps/api/prisma.config.ts',
      'apps/api/tsconfig.json',
      'packages/shared/package.json',
      'packages/shared/tsconfig.json',
      'packages/shared/tsup.config.ts',
    ])
      cpSync(join(root, name), join(directory, name))
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'))
    symlinkSync(join(root, 'apps/api/node_modules'), join(directory, 'apps/api/node_modules'))
    writeFileSync(join(directory, 'apps/api/src/generated/prisma/client.ts'), 'fixture')
    writeFileSync(join(directory, 'packages/shared/dist/index.js'), 'fixture')
    const { preflight } = await import(
      pathToFileURL(join(directory, 'scripts/api-e2e/prepare.mjs'))
    )
    const { inputHash, outputHash } = await import(
      pathToFileURL(join(directory, 'scripts/api-e2e/paths.mjs'))
    )
    const receipt = join(directory, '.amcore/api-e2e-prepared.json')
    assert.throws(preflight, /--prepare/)
    writeFileSync(receipt, JSON.stringify({ hash: inputHash(), outputs: outputHash() }))
    preflight()
    const swcPath = join(directory, 'apps/api/jest-swc.config.cjs')
    const swcOriginal = readFileSync(swcPath)
    writeFileSync(
      swcPath,
      Buffer.concat([swcOriginal, Buffer.from('\n// changed compiler setting')])
    )
    assert.throws(preflight, /--prepare/)
    writeFileSync(swcPath, swcOriginal)
    preflight()
    writeFileSync(join(directory, 'packages/shared/dist/index.js'), 'changed')
    assert.throws(preflight, /--prepare/)
    writeFileSync(join(directory, 'packages/shared/dist/index.js'), 'fixture')
    writeFileSync(join(directory, 'packages/shared/src/new.ts'), 'changed')
    assert.throws(preflight, /--prepare/)
    assert.equal(readFileSync(join(root, 'pnpm-lock.yaml')).length > 0, true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
