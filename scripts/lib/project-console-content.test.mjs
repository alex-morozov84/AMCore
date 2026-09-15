import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { projectConsoleContentDefinition } from './project-console-content.mjs'

const root = process.cwd()

function materialize(pathname, operationKey, params = {}) {
  return materializeProjectContentPath(root, pathname, [
    { kind: 'content', dimension: 'console', path: pathname, operationKey, params },
  ]).after
}

test('removes a mixed-document Console block and preserves surrounding content', () => {
  const pathname = 'docs/auth/README.md'
  const before = readFileSync(path.join(root, pathname), 'utf8')
  const after = materialize(pathname, 'console.auth-index')
  assert.ok(before.includes('[Operations Console](../operations-console/README.md)'))
  assert.equal(after.includes('[Operations Console](../operations-console/README.md)'), false)
  assert.ok(after.includes('## Quick start'))
})

test('treats the Console guide as a whole-feature root instead of shared content', () => {
  const pathname = 'docs/operations-console/README.md'
  assert.throws(
    () => materialize(pathname, 'console.operations-guide'),
    /unknown shared content operation/
  )
})

test('rewrites structural startup and single-locale login contributions', () => {
  const startup = materialize('apps/web/src/instrumentation.ts', 'console.startup-hook')
  assert.equal(startup.includes('validateAdminConsoleStartupOrExit'), false)
  assert.ok(startup.includes('onRequestError'))

  const login = materialize(
    'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx',
    'console.login-single-locale'
  )
  assert.equal(login.includes("from 'next-intl/server'"), false)
  assert.equal(login.includes("from '@/i18n/params'"), false)
  assert.ok(login.includes("ADMIN_CONSOLE_CONFIG.mode !== 'host'"))
})

test('rewrites custom-slug proxy blocks while retaining asset handling', () => {
  for (const [pathname, proxy, marker] of [
    ['docker/nginx/operations-console.conf', 'nginx', 'location ^~ /_next/'],
    ['docker/caddy/Caddyfile.console-host', 'caddy', '@nextAssets path /_next/*'],
  ]) {
    const after = materialize(pathname, 'console.proxy-single-locale', {
      slug: 'panel',
      proxy,
    })
    assert.ok(after.includes(marker))
    assert.ok(after.includes('/panel'))
    assert.equal(after.includes('/admin'), false)
  }
})

test('fails closed when an owned-block anchor is missing or duplicated', () => {
  const definition = projectConsoleContentDefinition('readme-console')
  const anchor = operationsConsoleOwnership.seams.find(
    (seam) => seam.id === 'console.root-capability'
  ).selector.text
  const source = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.throws(
    () => definition.apply(source.replace(anchor, 'removed marker')),
    /expected exactly one anchor/
  )
  assert.throws(() => definition.apply(`${source}\n${anchor}\n`), /expected exactly one anchor/)
})
