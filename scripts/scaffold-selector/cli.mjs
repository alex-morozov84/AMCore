#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { classifyChanges } from './classify.mjs'
import { readDeclaration, validateDeclarationTree } from './declaration.mjs'
import { declarationDigest } from './digest.mjs'
import { diffNameStatus, findMergeBase, listTree, readTextBlob } from './git.mjs'
import { buildDecision, buildFallback } from './output.mjs'
import { validateDecision } from './output-schema.mjs'

const MAX_BLOB_BYTES = 256 * 1024

function options() {
  return parseArgs({
    options: {
      repo: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      event: { type: 'string' },
      'base-ref': { type: 'string' },
      declaration: { type: 'string' },
      output: { type: 'string' },
      'selector-version': { type: 'string' },
    },
    strict: true,
  }).values
}

function requireOptions(values) {
  for (const name of ['base', 'head', 'declaration', 'output', 'selector-version']) {
    if (!values[name]) throw new Error(`--${name} is required`)
  }
}

function writeJson(pathname, value) {
  mkdirSync(path.dirname(pathname), { recursive: true })
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`)
}

function provenance(values, mergeBaseSha, digest) {
  return {
    event: values.event ?? 'unknown',
    baseRef: values['base-ref'] ?? null,
    baseSha: values.base,
    headSha: values.head,
    mergeBaseSha,
    diffRange: `${mergeBaseSha}..${values.head}`,
    declarationSha256: digest,
    trustSource: 'merge-base',
  }
}

function classify(values) {
  const repo = path.resolve(values.repo ?? process.cwd())
  const declarationPath = path.resolve(values.declaration)
  const declaration = readDeclaration(declarationPath)
  const mergeBaseSha = findMergeBase(repo, values.base, values.head)
  const baseFiles = listTree(repo, mergeBaseSha)
  const headFiles = listTree(repo, values.head)
  validateDeclarationTree(declaration, baseFiles)
  const changes = diffNameStatus(repo, mergeBaseSha, values.head)
  const readText = (side, pathname) =>
    readTextBlob(repo, side === 'base' ? mergeBaseSha : values.head, pathname, MAX_BLOB_BYTES)
  const classification = classifyChanges({ declaration, changes, baseFiles, headFiles, readText })
  return buildDecision({
    provenance: provenance(values, mergeBaseSha, declarationDigest(declarationPath)),
    selectorVersion: values['selector-version'],
    classification,
  })
}

function fallback(values, error) {
  const code = typeof error?.code === 'string' ? error.code : 'internal_error'
  return buildFallback({
    reason: code,
    detail: error?.message ?? 'unknown selector failure',
    provenance: {
      event: values.event,
      baseRef: values['base-ref'],
      baseSha: values.base ?? null,
      headSha: values.head ?? null,
    },
  })
}

const values = options()
try {
  requireOptions(values)
  const decision = validateDecision(classify(values))
  writeJson(values.output, decision)
} catch (error) {
  if (!values.output) throw error
  writeJson(values.output, validateDecision(fallback(values, error)))
}
