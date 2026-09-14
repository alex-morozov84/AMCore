import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducePathAlgebra } from './path-algebra-reduce.mjs'

describe('reducePathAlgebra — real named cases (FINAL PLAN §2.1)', () => {
  test('Storybook per-file delete + console whole-directory delete compose with zero pair-specific code', () => {
    const ops = reducePathAlgebra([
      {
        kind: 'delete',
        path: 'apps/web/src/widgets/console-shell/ui/ConsoleShell.stories.tsx',
        dimension: 'storybook-disabled',
      },
      { kind: 'delete', path: 'apps/web/src/widgets/console-shell', dimension: 'admin-console-disabled' },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'delete')
    assert.equal(ops[0].target, 'apps/web/src/widgets/console-shell')
  })

  test('single-locale admin-console login: move + content rewrite compose into one operation at the new destination', () => {
    const ops = reducePathAlgebra([
      {
        kind: 'move',
        from: 'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx',
        to: 'apps/web/src/app/admin/(auth)/login/page.tsx',
        dimension: 'single-locale',
      },
      {
        kind: 'content',
        path: 'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx',
        dimension: 'single-locale-rewrite',
      },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'move')
    assert.equal(ops[0].to, 'apps/web/src/app/admin/(auth)/login/page.tsx')
    assert.equal(ops[0].carriedContent.length, 1)
  })

  test('[locale] parent cleanup: the console is extracted before the [locale] directory delete', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'apps/web/src/app/[locale]', dimension: 'single-locale-cleanup' },
      {
        kind: 'move',
        from: 'apps/web/src/app/[locale]/admin/layout.tsx',
        to: 'apps/web/src/app/admin/layout.tsx',
        dimension: 'single-locale',
      },
      {
        kind: 'move',
        from: 'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx',
        to: 'apps/web/src/app/admin/(auth)/login/page.tsx',
        dimension: 'single-locale',
      },
      {
        kind: 'content',
        path: 'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx',
        dimension: 'single-locale-rewrite',
      },
    ])
    // The [locale] delete survives; both console files are extracted (moved
    // out) rather than absorbed, and the login page keeps its carried edit.
    assert.equal(ops.length, 3)
    const del = ops.find((op) => op.kind === 'delete')
    assert.equal(del.target, 'apps/web/src/app/[locale]')
    const login = ops.find((op) => op.to === 'apps/web/src/app/admin/(auth)/login/page.tsx')
    assert.equal(login.carriedContent.length, 1)
    const layout = ops.find((op) => op.to === 'apps/web/src/app/admin/layout.tsx')
    assert.ok(layout)
  })

  test('the [locale] cleanup delete does not precede its own extractions (regression: real ordering, not just presence)', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'apps/web/src/app/[locale]', dimension: 'single-locale-cleanup' },
      {
        kind: 'move',
        from: 'apps/web/src/app/[locale]/admin/layout.tsx',
        to: 'apps/web/src/app/admin/layout.tsx',
        dimension: 'single-locale',
      },
    ])
    const deleteIndex = ops.findIndex((op) => op.kind === 'delete')
    const moveIndex = ops.findIndex((op) => op.kind === 'move')
    assert.ok(moveIndex < deleteIndex)
  })
})

describe('reducePathAlgebra — determinism', () => {
  test('permuting the input fact order produces an identical materialized plan', () => {
    const facts = [
      { kind: 'delete', path: 'apps/web/src/widgets/console-shell/ui/ConsoleShell.stories.tsx', dimension: 'storybook' },
      { kind: 'delete', path: 'apps/web/src/widgets/console-shell', dimension: 'console' },
      { kind: 'delete', path: 'apps/web/src/app/[locale]', dimension: 'locale-cleanup' },
      { kind: 'move', from: 'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx', to: 'apps/web/src/app/admin/(auth)/login/page.tsx', dimension: 'single-locale' },
      { kind: 'content', path: 'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx', dimension: 'single-locale-rewrite' },
      { kind: 'content', path: 'apps/web/messages/en.json', dimension: 'locale-fixtures' },
    ]
    const forward = reducePathAlgebra(facts)
    const reversed = reducePathAlgebra([...facts].reverse())
    // A pseudo-random-ish shuffle, still deterministic across test runs.
    const shuffled = [facts[3], facts[0], facts[5], facts[1], facts[4], facts[2]]
    const shuffledResult = reducePathAlgebra(shuffled)

    assert.deepEqual(reversed, forward)
    assert.deepEqual(shuffledResult, forward)
  })
})
