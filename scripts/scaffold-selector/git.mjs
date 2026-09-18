import { spawnSync } from 'node:child_process'
import { TextDecoder } from 'node:util'

import { fail } from './errors.mjs'
import { validatePath } from './paths.mjs'

const SHA = /^[0-9a-f]{40}$/u

function runGit(repo, args, encoding) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.toString().trim() || result.error?.message || args[0]
    fail('git_error', `git ${args[0]} failed: ${detail}`)
  }
  return result.stdout
}

export function validateSha(value, label) {
  if (!SHA.test(value ?? '')) fail('git_error', `${label} must be a full 40-character SHA`)
  return value
}

export function assertCommit(repo, sha, label) {
  validateSha(sha, label)
  const type = runGit(repo, ['cat-file', '-t', sha], 'utf8').trim()
  if (type !== 'commit') fail('git_error', `${label} is not a commit`)
}

export function findMergeBase(repo, baseSha, headSha) {
  assertCommit(repo, baseSha, 'base SHA')
  assertCommit(repo, headSha, 'head SHA')
  const lines = runGit(repo, ['merge-base', baseSha, headSha], 'utf8').trim().split('\n')
  if (lines.length !== 1) fail('git_error', 'expected exactly one merge base')
  return validateSha(lines[0], 'merge-base SHA')
}

function pathRecord(value) {
  try {
    return validatePath(value, 'diff path')
  } catch (error) {
    fail('parser_error', error.message)
  }
}

export function parseNameStatus(buffer) {
  const records = buffer.toString('utf8').split('\0')
  if (records.at(-1) !== '') fail('parser_error', 'name-status output is not NUL terminated')
  records.pop()
  const changes = []
  for (let index = 0; index < records.length;) {
    const token = records[index++]
    if (/^[AMD]$/u.test(token)) {
      changes.push({ status: token, path: pathRecord(records[index++]) })
    } else if (/^R\d{1,3}$/u.test(token)) {
      changes.push({
        status: 'R',
        score: Number(token.slice(1)),
        oldPath: pathRecord(records[index++]),
        path: pathRecord(records[index++]),
      })
    } else {
      fail('parser_error', `unsupported or malformed diff status: ${token}`)
    }
  }
  const endpoints = changes.flatMap((item) => [item.oldPath, item.path].filter(Boolean))
  if (new Set(endpoints).size !== endpoints.length) {
    fail('parser_error', 'duplicate or conflicting diff paths')
  }
  return changes
}

export function diffNameStatus(repo, mergeBaseSha, headSha) {
  const range = `${mergeBaseSha}..${headSha}`
  return parseNameStatus(
    runGit(repo, ['diff', '--name-status', '-z', '--find-renames', range], undefined)
  )
}

export function listTree(repo, sha) {
  const output = runGit(repo, ['ls-tree', '-r', '-z', '--name-only', sha], undefined)
  const records = output.toString('utf8').split('\0')
  if (records.at(-1) !== '') fail('parser_error', 'ls-tree output is not NUL terminated')
  records.pop()
  return records.map(pathRecord).sort()
}

export function readTextBlob(repo, sha, pathname, maxBytes) {
  const object = `${sha}:${pathname}`
  const size = Number(runGit(repo, ['cat-file', '-s', object], 'utf8').trim())
  if (!Number.isSafeInteger(size) || size > maxBytes) return { kind: 'oversized' }
  const bytes = runGit(repo, ['cat-file', 'blob', object], undefined)
  if (bytes.includes(0)) return { kind: 'binary' }
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { kind: 'binary' }
  }
}
