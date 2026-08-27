// Runs against a disposable copy of the real apps/web tree (not a
// hand-written fixture) — a fixture invented to match this step's paths
// couldn't catch the routing tree actually having moved/renamed since this
// was written.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy } from './test-fixture.mjs'
import {
  buildWebStructureSteps,
  buildWebLocaleDirCleanupSteps,
} from './project-plan-web-structure.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

describe('buildWebStructureSteps (against a real repo copy)', () => {
  test('moves every pure-move file and deletes every target, leaving nothing dangling', () => {
    copy = createRealRepoCopy()
    const steps = buildWebStructureSteps(copy.root)

    for (const step of steps) step.write()

    const moved = [
      'apps/web/src/app/(dashboard)/error.tsx',
      'apps/web/src/app/(dashboard)/layout.tsx',
      'apps/web/src/app/(dashboard)/page.tsx',
      'apps/web/src/app/(dashboard)/settings/sessions/page.tsx',
      'apps/web/src/app/providers.tsx',
    ]
    for (const rel of moved) {
      assert.equal(
        existsSync(path.join(copy.root, rel)),
        true,
        `expected ${rel} to exist after the move`
      )
    }

    const oldLocations = moved.map((rel) =>
      rel.replace('apps/web/src/app/', 'apps/web/src/app/[locale]/')
    )
    for (const rel of oldLocations) {
      assert.equal(
        existsSync(path.join(copy.root, rel)),
        false,
        `expected the old ${rel} to be gone`
      )
    }

    const deleted = [
      'apps/web/src/proxy.ts',
      'apps/web/src/i18n/routing.ts',
      'apps/web/src/i18n/navigation.ts',
      'apps/web/src/i18n/params.ts',
      'apps/web/src/features/locale-switcher',
    ]
    for (const rel of deleted) {
      assert.equal(existsSync(path.join(copy.root, rel)), false, `expected ${rel} to be deleted`)
    }

    // i18n/request.ts and i18n/messages.test.ts are rewritten/kept by a
    // different slice, not deleted by this one.
    assert.equal(existsSync(path.join(copy.root, 'apps/web/src/i18n/request.ts')), true)

    // [locale] itself is not removed by this slice -- other files inside it
    // (the pages/layout move-and-rewrites) haven't run yet in isolation here.
    assert.equal(existsSync(path.join(copy.root, 'apps/web/src/app/[locale]')), true)
  })
})

describe('buildWebLocaleDirCleanupSteps (against a real repo copy)', () => {
  // This step deletes recursively regardless of remaining content -- it is
  // meant to run last, after every other apps/web slice has already moved
  // its files out. The ordering guarantee itself is exercised by
  // project-plan-web-pages.test.mjs's full-sequence test, not here.
  test('removes the [locale] directory', () => {
    copy = createRealRepoCopy()
    assert.equal(existsSync(path.join(copy.root, 'apps/web/src/app/[locale]')), true)

    for (const step of buildWebLocaleDirCleanupSteps(copy.root)) step.write()

    assert.equal(existsSync(path.join(copy.root, 'apps/web/src/app/[locale]')), false)
  })
})
