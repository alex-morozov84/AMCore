import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { checkMessageSelections } from './client-message-selection-contract.mjs'

const root = resolve(import.meta.dirname, '../..')
const catalogue = new Set(
  Object.keys(JSON.parse(readFileSync(`${root}/apps/web/messages/en.json`, 'utf8')))
)
const statement = "import { ClientMessages as Scope } from '@/i18n/client-message-boundary';"
const check = (body) => checkMessageSelections(statement + body, 'example.tsx', catalogue)

test('rejects raw, repeated, unknown and computed selections while accepting local const tuples', () => {
  for (const body of [
    '<Scope namespaces={[]} />',
    '<Scope namespaces={["auth", "auth"]} />',
    '<Scope namespaces={["newUnknownNamespace"]} />',
    '<Scope namespaces={Object.keys(catalogue)} />',
    '<Scope namespaces={[...selected]} />',
    '<Scope messages={catalogue} />',
    '<Scope {...props} namespaces={["auth"]} />',
    'let names = ["auth"]; <Scope namespaces={names} />',
    'const names = Object.keys(catalogue); function Other() { const names = ["auth"] } <Scope namespaces={names} />',
    'function Other() { const names = ["auth"] } <Scope namespaces={names} />',
    'const names = ["auth"]; function Other(names: string[]) { return <Scope namespaces={names} /> }',
  ])
    assert(check(body).errors.length > 0, body)
  assert.deepEqual(
    check('const names = ["auth"] as const; <Scope namespaces={names} />').errors,
    []
  )
  assert.deepEqual(check('<Scope namespaces={["auth"]} />').errors, [])
})

test('all production section selections are explicit and the root has exactly one composition caller', () => {
  const sourceRoot = `${root}/apps/web/src`
  const roots = []
  let sections = 0
  for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !/\.tsx?$/.test(entry.name) ||
      /\.(test|spec|stories)\./.test(entry.name)
    )
      continue
    const file = resolve(entry.parentPath, entry.name)
    if (file.includes('/src/test/')) continue
    const result = checkMessageSelections(readFileSync(file, 'utf8'), file, catalogue)
    assert.deepEqual(result.errors, [], file)
    roots.push(...result.roots)
    sections += result.sections
  }
  assert.deepEqual(roots, [`${sourceRoot}/app/[locale]/layout.tsx`])
  assert(sections > 0, 'Section inventory must not be empty')
})
