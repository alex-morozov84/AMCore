import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, access } from 'node:fs/promises'
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
