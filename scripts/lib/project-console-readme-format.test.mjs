import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { compactConsoleReadmeTable } from './project-console-readme-format.mjs'

const source = readFileSync('README.md', 'utf8')
const heading = '### Frontend Starter Capabilities'

test('readme padding compaction is stable and rejects missing or ambiguous tables', () => {
  assert.equal(compactConsoleReadmeTable(source), source)
  assert.throws(() => compactConsoleReadmeTable(source.replace(heading, 'removed')), /exactly one/)
  assert.throws(() => compactConsoleReadmeTable(`${source}\n${heading}\n`), /exactly one/)
  assert.throws(
    () =>
      compactConsoleReadmeTable(
        source.replace(`${heading}\n\n| Capability `, `${heading}\n\n| Removed `)
      ),
    /missing/
  )
  const separator = source.slice(source.indexOf(heading)).split('\n')[3]
  assert.throws(
    () => compactConsoleReadmeTable(source.replace(separator, '| broken |')),
    /separator/
  )
})
