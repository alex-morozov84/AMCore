import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { localeGuardSourceFiles } from './project-locale-source-files.mjs'

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false })
  assert.equal(result.status, 0, result.stderr)
}

test('includes untracked sources and excludes ignored or deleted sources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'locale-source-files-'))
  try {
    await mkdir(path.join(root, 'apps/web/.next'), { recursive: true })
    await writeFile(path.join(root, '.gitignore'), '.next/\n')
    await writeFile(path.join(root, 'apps/web/tracked.ts'), '')
    await writeFile(path.join(root, 'apps/web/new.tsx'), '')
    await writeFile(path.join(root, 'apps/web/.next/generated.js'), '')
    git(root, ['init', '--quiet'])
    git(root, ['add', '.gitignore', 'apps/web/tracked.ts'])

    assert.deepEqual(localeGuardSourceFiles(root).sort(), [
      'apps/web/new.tsx',
      'apps/web/tracked.ts',
    ])

    await rm(path.join(root, 'apps/web/tracked.ts'))
    assert.deepEqual(localeGuardSourceFiles(root), ['apps/web/new.tsx'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
