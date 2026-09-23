import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  applyProject,
  createCommittedCopy,
  runInitProject,
} from './lib/init-project-test-helpers.mjs'
import { operationsConsoleOwnership } from './lib/operations-console-ownership.mjs'
import { filesForFacts } from './lib/ownership-facts.mjs'
import { assertSharedSearchRetained } from './lib/shared-search-scaffold-assertions.mjs'
import { validateOwnership } from './lib/ownership-validate.mjs'

const copies = []
afterEach(() => copies.splice(0).forEach((copy) => copy.cleanup()))

const copy = () => createCommittedCopy(copies)

function removableConsolePaths(root) {
  const { inventory, projection } = validateOwnership(root, operationsConsoleOwnership)
  const matched = (facts) => [...filesForFacts(inventory, facts)]
  return [
    ...operationsConsoleOwnership.facts.roots.map((fact) => fact.path),
    ...projection.deadSharedModules,
    ...matched(operationsConsoleOwnership.facts.sharedModuleTests).filter((file) =>
      projection.removed.has(file)
    ),
    ...matched(operationsConsoleOwnership.facts.topology),
    ...matched(operationsConsoleOwnership.facts.verification),
  ]
}

describe('init-project --admin-console', () => {
  it('allows each explicit first transition from the pristine default', () => {
    for (const [mode, slug] of [['disabled'], ['path', 'panel'], ['host', 'panel']]) {
      const root = copy()
      applyProject(root, [
        `--admin-console=${mode}`,
        ...(slug ? [`--admin-console-slug=${slug}`] : []),
      ])
      const context = readFileSync(path.join(root, 'PROJECT_CONTEXT.md'), 'utf8')
      assert.ok(
        context.includes(`**admin_console:** ${mode === 'disabled' ? 'disabled' : 'enabled'}`)
      )
      if (slug) {
        assert.equal(existsSync(path.join(root, 'apps/web/src/app/[locale]', slug)), true)
        const config = readFileSync(
          path.join(root, 'apps/web/src/shared/lib/admin-console.generated.ts'),
          'utf8'
        )
        assert.match(config, new RegExp(`mode: '${mode}'`))
        assert.match(config, new RegExp(`slug: '${slug}'`))
        for (const rel of [
          'docker/nginx/operations-console.conf',
          'docker/caddy/Caddyfile.console-host',
        ]) {
          assert.match(readFileSync(path.join(root, rel), 'utf8'), new RegExp(`/${slug}`))
        }
      }
    }
  })

  it('removes only console-owned frontend/runtime files when disabled', () => {
    const root = copy()
    const ownedPaths = removableConsolePaths(root)
    applyProject(root, ['--admin-console=disabled'])
    for (const rel of ownedPaths) {
      assert.equal(existsSync(path.join(root, rel)), false, rel)
    }
    assert.equal(existsSync(path.join(root, 'apps/web/src/features/console-discovery')), false)
    assertSharedSearchRetained(root)
    const nginx = readFileSync(path.join(root, 'docker/nginx/operations-console.conf'), 'utf8')
    assert.equal(nginx.includes('AMCORE_ADMIN_CONSOLE_PROXY'), false)
    for (const [rel, marker] of [
      ['apps/web/src/instrumentation.ts', 'admin-console-startup'],
      ['apps/web/src/app/globals.css', 'console-accent'],
      ['apps/web/messages/en.json', '"console"'],
      ['docker-compose.yml', 'ADMIN_CONSOLE_HOSTNAME'],
    ]) {
      assert.equal(readFileSync(path.join(root, rel), 'utf8').includes(marker), false, rel)
    }
    for (const rel of [
      'apps/api/src/core/admin/admin.controller.ts',
      'apps/api/src/core/auth/guards/fresh-auth.guard.ts',
      'apps/api/src/core/audit/audit-log.service.ts',
      'apps/api/src/health/health.controller.ts',
      'apps/api/src/infrastructure/observability/metrics.service.ts',
    ]) {
      assert.equal(existsSync(path.join(root, rel)), true, rel)
    }
    for (const rel of [
      'README.md',
      'docs/README.md',
      'docs/frontend/README.md',
      'docs/auth/README.md',
      'docs/operations/README.md',
    ]) {
      assert.equal(
        readFileSync(path.join(root, rel), 'utf8').includes('operations-console/README.md'),
        false,
        rel
      )
    }
    const rootReadme = readFileSync(path.join(root, 'README.md'), 'utf8')
    assert.equal(rootReadme.includes('| **Operations Console**'), false)
    assert.equal(rootReadme.includes('│   ├── operations-console/'), false)
  })

  it('rejects unchanged, repeated, and invalid transitions without writing', () => {
    const root = copy()
    const unchanged = runInitProject(root, ['--admin-console=path', '--yes'])
    assert.match(unchanged.stderr, /already at the upstream default/)
    applyProject(root, ['--admin-console=host', '--admin-console-slug=panel'])
    const repeated = runInitProject(root, ['--admin-console=disabled', '--yes'])
    assert.match(repeated.stderr, /one-time choice cannot run again/)
    const invalid = runInitProject(copy(), [
      '--admin-console=host',
      '--admin-console-slug=api',
      '--yes',
    ])
    assert.match(invalid.stderr, /collides with an existing URL segment/)
  })

  it('composes disabled console with the existing scaffold dimensions', () => {
    const root = copy()
    applyProject(root, [
      '--admin-console=disabled',
      '--mode=single',
      '--locale=ru',
      '--storybook=disabled',
      '--route-progress=disabled',
    ])
    assert.equal(existsSync(path.join(root, 'apps/web/src/app/[locale]/admin')), false)
    assert.equal(
      existsSync(path.join(root, 'apps/web/src/shared/lib/admin-console.generated.ts')),
      false
    )
    assert.equal(existsSync(path.join(root, '.storybook')), false)
    const webPackage = readFileSync(path.join(root, 'apps/web/package.json'), 'utf8')
    const frontendIndex = readFileSync(path.join(root, 'docs/frontend/README.md'), 'utf8')
    assert.equal(webPackage.includes('test:e2e:console-real-stack'), false)
    assert.equal(webPackage.includes('test:storybook'), false)
    assert.equal(frontendIndex.includes('Operations Console shell'), false)
    assert.equal(frontendIndex.includes('| [Storybook]'), false)
    assert.equal(existsSync(path.join(root, 'apps/web/src/features/console-discovery')), false)
    assertSharedSearchRetained(root, { storybook: false })
  })
})
