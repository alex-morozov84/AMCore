import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertCleanGitTree,
  assertNotMaintainerCheckout,
  SafetyError,
  MAINTAINER_OVERRIDE_TOKEN,
} from './safety.mjs'

let repo

function git(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'amcore-safety-test-'))
  git(['init', '--quiet'])
  git([
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'init',
    '--quiet',
  ])
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('assertCleanGitTree', () => {
  test('does not throw on a clean tree', () => {
    assert.doesNotThrow(() => assertCleanGitTree(repo))
  })

  test('throws when there is an untracked file', () => {
    writeFileSync(path.join(repo, 'untracked.txt'), 'x')
    assert.throws(() => assertCleanGitTree(repo), SafetyError)
  })
})

describe('assertNotMaintainerCheckout', () => {
  test('does not throw when ai/ is absent', () => {
    assert.doesNotThrow(() => assertNotMaintainerCheckout(repo, undefined))
  })

  test('throws when ai/ is present and no token is given', () => {
    mkdirSync(path.join(repo, 'ai'))
    assert.throws(() => assertNotMaintainerCheckout(repo, undefined), SafetyError)
  })

  test('throws when ai/ is present and the token is wrong', () => {
    mkdirSync(path.join(repo, 'ai'))
    assert.throws(() => assertNotMaintainerCheckout(repo, 'not-the-token'), SafetyError)
  })

  test('does not throw when ai/ is present and the exact token is given', () => {
    mkdirSync(path.join(repo, 'ai'))
    assert.doesNotThrow(() => assertNotMaintainerCheckout(repo, MAINTAINER_OVERRIDE_TOKEN))
  })
})
