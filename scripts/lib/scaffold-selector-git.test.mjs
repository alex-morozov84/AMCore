import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  diffNameStatus,
  findMergeBase,
  listTree,
  parseNameStatus,
} from '../scaffold-selector/git.mjs'

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function write(root, name, content) {
  const target = path.join(root, name)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function repository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'amcore-selector-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Selector Test')
  git(root, 'config', 'user.email', 'selector@example.invalid')
  write(root, 'keep.md', 'before\n')
  write(root, 'delete.md', 'delete\n')
  write(root, 'rename.md', 'rename\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'base')
  const base = git(root, 'rev-parse', 'HEAD')
  write(root, 'keep.md', 'after\n')
  write(root, 'added.md', 'added\n')
  git(root, 'rm', '-q', 'delete.md')
  git(root, 'mv', 'rename.md', 'renamed.md')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'head')
  return { root, base, head: git(root, 'rev-parse', 'HEAD') }
}

test('reads one merge-base diff with A/M/D/R and tree membership', () => {
  const fixture = repository()
  try {
    assert.equal(findMergeBase(fixture.root, fixture.base, fixture.head), fixture.base)
    assert.deepEqual(diffNameStatus(fixture.root, fixture.base, fixture.head), [
      { status: 'A', path: 'added.md' },
      { status: 'D', path: 'delete.md' },
      { status: 'M', path: 'keep.md' },
      { status: 'R', score: 100, oldPath: 'rename.md', path: 'renamed.md' },
    ])
    assert.ok(listTree(fixture.root, fixture.head).includes('renamed.md'))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('rejects copies, type changes, malformed records, duplicates, and control paths', () => {
  for (const value of [
    'C100\0old\0new\0',
    'T\0path\0',
    'M\0missing-terminator',
    'M\0same\0A\0same\0',
    'M\0bad\npath\0',
  ])
    assert.throws(() => parseNameStatus(Buffer.from(value)), /NUL|unsupported|duplicate|control/u)
})
