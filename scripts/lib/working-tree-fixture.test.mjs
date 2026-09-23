import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { assertBlockOrder } from './ownership-seams.mjs'
import { createWorkingTreeCopy, resolvePublicRepoRoot } from './working-tree-fixture.mjs'

function write(root, relative, content) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

test('working-tree copy preserves current files, deletions, symlinks and modes', () => {
  const source = mkdtempSync(path.join(tmpdir(), 'amcore-working-source-'))
  const privatePath = path.join('ai', 'private.md')
  let copy
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: source })
    write(source, '.gitignore', 'ai/\nnode_modules/\n.next/\n')
    write(source, 'tracked.txt', 'before\n')
    write(source, 'deleted.txt', 'remove me\n')
    write(source, 'docs/step.md', '1. Old start\nOld end\n')
    write(
      source,
      'config/seam.json',
      '{"id":"step","selector":{"start":"Old start","end":"Old end"}}'
    )
    write(source, 'tool.sh', '#!/bin/sh\nexit 0\n')
    chmodSync(path.join(source, 'tool.sh'), 0o755)
    symlinkSync('tracked.txt', path.join(source, 'link.txt'))
    execFileSync('git', ['add', '-A'], { cwd: source })
    write(source, 'tracked.txt', 'after\n')
    write(source, 'docs/step.md', '2. New start\nNew end\n')
    write(
      source,
      'config/seam.json',
      '{"id":"step","selector":{"start":"New start","end":"New end"}}'
    )
    unlinkSync(path.join(source, 'deleted.txt'))
    write(source, 'new.txt', 'untracked\n')
    write(source, privatePath, 'private\n')
    write(source, 'node_modules/package/file.js', 'ignored\n')
    write(source, '.next/output.js', 'ignored\n')

    assert.equal(resolvePublicRepoRoot(path.join(source, 'node_modules')), realpathSync(source))
    copy = createWorkingTreeCopy(source)
    assert.equal(readFileSync(path.join(copy.root, 'tracked.txt'), 'utf8'), 'after\n')
    const doc = readFileSync(path.join(copy.root, 'docs/step.md'), 'utf8')
    const seam = JSON.parse(readFileSync(path.join(copy.root, 'config/seam.json'), 'utf8'))
    assert.doesNotThrow(() => assertBlockOrder(doc, seam, 'docs/step.md'))
    assert.equal(readFileSync(path.join(copy.root, 'new.txt'), 'utf8'), 'untracked\n')
    assert.equal(existsSync(path.join(copy.root, 'deleted.txt')), false)
    assert.equal(lstatSync(path.join(copy.root, 'link.txt')).isSymbolicLink(), true)
    assert.equal(readlinkSync(path.join(copy.root, 'link.txt')), 'tracked.txt')
    assert.equal(lstatSync(path.join(copy.root, 'tool.sh')).mode & 0o111, 0o111)
    for (const excluded of [privatePath, 'node_modules/package/file.js', '.next/output.js']) {
      assert.equal(existsSync(path.join(copy.root, excluded)), false)
    }
  } finally {
    copy?.cleanup()
    rmSync(source, { recursive: true, force: true })
  }
})

test('root resolution fails closed outside Git', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'amcore-no-git-'))
  try {
    assert.throws(() => resolvePublicRepoRoot(directory), /cannot resolve public repository root/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
