import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

function fact(pathname, operationKey) {
  return { kind: 'content', dimension: 'test', path: pathname, operationKey, params: {} }
}

function withCopy(run) {
  const copy = createRealRepoCopy()
  try {
    run(copy.root)
  } finally {
    copy.cleanup()
  }
}

test('a duplicate Markdown field anchor fails closed', () => {
  withCopy((root) => {
    const pathname = 'PROJECT_CONTEXT.md'
    const target = path.join(root, pathname)
    const content = readFileSync(target, 'utf8')
    const anchor = '- **frontend_route_progress:** `enabled`'
    writeFileSync(target, `${content}\n${anchor}\n`)
    assert.throws(
      () =>
        materializeProjectContentPath(root, pathname, [fact(pathname, 'context-route-progress')]),
      /expected exactly one match/
    )
  })
})

test('a missing owned Markdown block fails closed', () => {
  withCopy((root) => {
    const pathname = 'README.md'
    const target = path.join(root, pathname)
    const content = readFileSync(target, 'utf8').replace('| Storybook ', '| RemovedBook ')
    writeFileSync(target, content)
    assert.throws(
      () => materializeProjectContentPath(root, pathname, [fact(pathname, 'readme-storybook')]),
      /expected exactly one occurrence/
    )
  })
})

test('a missing JSON path fails closed instead of silently winning', () => {
  withCopy((root) => {
    const pathname = 'apps/web/package.json'
    const target = path.join(root, pathname)
    const content = JSON.parse(readFileSync(target, 'utf8'))
    delete content.scripts.storybook
    writeFileSync(target, `${JSON.stringify(content, null, 2)}\n`)
    assert.throws(
      () => materializeProjectContentPath(root, pathname, [fact(pathname, 'package-storybook')]),
      /key not found/
    )
  })
})

test('a delete without its semantic claim fails closed', () => {
  withCopy((root) => {
    const pathname = 'apps/web/messages/ru.json'
    assert.throws(
      () =>
        materializeProjectContentPath(root, pathname, [
          { kind: 'delete', dimension: 'locale', path: pathname, claims: [] },
        ]),
      /requires its filesystem semantic claim/
    )
  })
})
