import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
  access,
  rename,
  readdir,
} from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshot } from './snapshot.mjs'
import { run } from './process.mjs'

test('sanitized copy includes dirty/untracked public source, excludes tracked env/private ai and refuses escaping symlink', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-source-proof-'))
  const repo = join(dir, 'checkout')
  const copy = join(dir, 'snapshot')
  try {
    await mkdir(repo)
    await mkdir(copy)
    await run('git', ['init', '-q'], { cwd: repo, capture: true })
    for (const name of ['source.ts', '.env', '.env.example'])
      await writeFile(join(repo, name), 'original')
    await run('git', ['add', '--', 'source.ts', '.env', '.env.example'], {
      cwd: repo,
      capture: true,
    })
    await writeFile(join(repo, 'source.ts'), 'dirty source')
    await writeFile(join(repo, 'new.ts'), 'new source')
    await mkdir(join(repo, 'ai'))
    await writeFile(join(repo, 'ai', 'private.md'), 'private')
    await mkdir(join(repo, 'apps/api/src/core/ai'), { recursive: true })
    await writeFile(join(repo, 'apps/api/src/core/ai/module.ts'), 'public AI source')
    const hash = await snapshot(repo, copy)
    assert.equal(await snapshot(repo), hash)
    assert.equal(await readFile(join(copy, 'source.ts'), 'utf8'), 'dirty source')
    assert.equal(await readFile(join(copy, 'new.ts'), 'utf8'), 'new source')
    assert.equal(
      await readFile(join(copy, 'apps/api/src/core/ai/module.ts'), 'utf8'),
      'public AI source'
    )
    await assert.rejects(() => access(join(copy, '.env')))
    await assert.rejects(() => access(join(copy, 'ai')))
    await symlink(join(dir, 'foreign'), join(repo, 'escape'))
    await assert.rejects(() => snapshot(repo, join(dir, 'refused')), /symlink/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('snapshot preserves the published copy when a tracked path escapes or changes during a read', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-source-race-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, 'checkout')
  const copy = join(dir, 'snapshot')
  const parent = join(repo, 'nested')
  const external = join(dir, 'external')
  await mkdir(parent, { recursive: true })
  await mkdir(external)
  await writeFile(join(parent, 'source.ts'), 'admitted')
  await writeFile(join(external, 'source.ts'), 'external')
  await run('git', ['init', '-q'], { cwd: repo, capture: true })
  await run('git', ['add', '-f', 'nested/source.ts'], { cwd: repo, capture: true })
  await writeFile(join(repo, '.gitignore'), '/nested\n')
  const hash = await snapshot(repo, copy)
  assert.equal(await snapshot(repo), hash)
  const saved = join(dir, 'saved')
  await rename(parent, saved)
  await symlink(external, parent)
  await assert.rejects(snapshot(repo, copy), /symlink/)
  assert.equal(await readFile(join(copy, 'nested/source.ts'), 'utf8'), 'admitted')

  await rm(parent)
  await rename(saved, parent)
  const openFile = fs.open
  let swapped = false
  let link = true
  const mock = t.mock.method(fs, 'open', async (path, ...args) => {
    const handle = await openFile(path, ...args)
    if (!swapped && path.endsWith('/source.ts')) {
      swapped = true
      await rename(parent, saved)
      if (link) await symlink(external, parent)
      else {
        await mkdir(parent)
        await writeFile(join(parent, 'source.ts'), 'replacement')
      }
    }
    return handle
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(snapshot(repo, copy), /symlink/)
    assert.equal(swapped, true)
    await rm(parent)
    await rename(saved, parent)
    swapped = false
    link = false
    await assert.rejects(snapshot(repo, copy), /changed during read/)
    assert.equal(swapped, true)
    assert.equal(await readFile(join(copy, 'nested/source.ts'), 'utf8'), 'admitted')
    assert.equal(
      (await readdir(dir)).some((name) => name.startsWith('.snapshot-')),
      false
    )
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
  }
})
