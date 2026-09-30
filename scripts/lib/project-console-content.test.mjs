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

test('disabled Console docs retain Settings pending proof and its runnable command', () => {
  const after = materialize('docs/frontend/testing.md', 'console.sessions-readability-guide')
  assert.match(after, /Settings covers both themes/)
  assert.match(after, /sessions-readability\.spec\.ts/)
  assert.doesNotMatch(after, /admin-sessions\/readability|actual initials on the composited/)
})

test('disabled Console docs preserve API audit redaction without a dead guide link', () => {
  const after = materialize('docs/operations/audit-log.md', 'console.audit-history-guide')
  assert.match(after, /request query and raw URL logs/)
  assert.doesNotMatch(after, /operations-console\/configuration|With the optional Console/)
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
    assert.ok(after.includes('/api/deployment-version'))
    assert.ok(after.includes('/api/console/'))
    assert.ok(
      after.includes(
        proxy === 'nginx'
          ? 'location = /api/deployment-version {'
          : '@deploymentVersion path /api/deployment-version'
      )
    )
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

test('fails closed instead of mixing structural and text adapters on one path', () => {
  const pathname = 'apps/web/src/instrumentation.ts'
  assert.throws(
    () =>
      materializeProjectContentPath(root, pathname, [
        {
          kind: 'content',
          dimension: 'console',
          path: pathname,
          operationKey: 'console.startup-hook',
          params: {},
        },
        {
          kind: 'content',
          dimension: 'other',
          path: pathname,
          operationKey: 'console.tokens',
          params: {},
        },
      ]),
    /mixed structural\/text operations/
  )
})


test('disabled Console removes its product-admin link while keeping integration guidance', () => {
  const after = materialize('docs/product-admin/README.md', 'console.product-admin-intro')
  assert.doesNotMatch(after, /operations-console\/README\.md/)
  assert.match(after, /# Product administration foundation/)
  assert.match(after, /signed-in members/)
  assert.match(after, /## Connect the ready pages/)
  assert.match(after, /organizationAccessPlacement/)
})
