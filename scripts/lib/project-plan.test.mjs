// Structural invariant over the full init:project plans, independent of any
// real-repo copy: fileStep/exactContentStep read their target file once at
// plan-build time, so two separate steps targeting the same path silently
// clobber each other at write() time (the second step's `after` was
// computed from the pre-first-step content). Caught live: auth.service.spec.ts
// (two builders owned a fileStep for it), then PROJECT_CONTEXT.md/
// eslint.config.mjs when --mode and --storybook combine (see
// the shared semantic composer). Covers the console dimension together with every
// existing scaffold dimension, mirroring init-project.mjs's
// own filter+combine composition — not a naive concatenation, which would
// trivially fail on any combined case by design (the whole reason
// shared-file composition exists).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareProjectInit } from './project-init-plan.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function isNested(path, parent) {
  return path === parent || path.startsWith(`${parent}/`)
}

function assertNoDestructivePathConflict(steps) {
  const writers = steps.filter((step) => step.kind !== 'delete')
  assert.equal(new Set(writers.map((step) => step.target)).size, writers.length)
  const moves = steps.filter((step) => step.source)
  assert.equal(new Set(moves.map((step) => step.source)).size, moves.length)

  for (const [index, step] of steps.entries()) {
    if (step.kind !== 'delete') continue
    for (const earlier of steps
      .slice(0, index)
      .filter((candidate) => candidate.kind !== 'delete')) {
      assert.equal(
        isNested(earlier.target, step.target),
        false,
        `${step.target} removes ${earlier.target}`
      )
    }
    for (const later of steps.slice(index + 1)) {
      assert.equal(
        isNested(later.target, step.target),
        false,
        `${step.target} precedes ${later.target}`
      )
      if (later.source) {
        assert.equal(
          isNested(later.source, step.target),
          false,
          `${step.target} precedes ${later.source}`
        )
      }
    }
  }
}

function composedSteps({ locale, storybook, routeProgress, adminConsole }) {
  const flags = {
    mode: locale ? 'single' : undefined,
    locale,
    storybook,
    'route-progress': routeProgress ? 'disabled' : undefined,
    'admin-console': adminConsole?.mode,
  }
  return prepareProjectInit(REPO_ROOT, flags, adminConsole?.slug ?? 'admin').steps
}

const COMBINATIONS = [
  { name: 'locale alone', locale: 'en' },
  { name: 'storybook alone', storybook: 'disabled' },
  { name: 'route-progress alone', routeProgress: true },
  { name: 'locale + storybook', locale: 'en', storybook: 'disabled' },
  { name: 'locale + route-progress', locale: 'en', routeProgress: true },
  { name: 'storybook + route-progress', storybook: 'disabled', routeProgress: true },
  { name: 'all three', locale: 'en', storybook: 'disabled', routeProgress: true },
  { name: 'console disabled alone', adminConsole: { mode: 'disabled', slug: 'admin' } },
  { name: 'console host alone', adminConsole: { mode: 'host', slug: 'panel' } },
  { name: 'single en preserves default console', locale: 'en' },
  {
    name: 'single ru keeps host default',
    locale: 'ru',
    adminConsole: { mode: 'host', slug: 'admin' },
  },
  {
    name: 'single en keeps host custom',
    locale: 'en',
    adminConsole: { mode: 'host', slug: 'panel' },
  },
  {
    name: 'single ru keeps path custom',
    locale: 'ru',
    adminConsole: { mode: 'path', slug: 'panel' },
  },
  {
    name: 'single en disables console',
    locale: 'en',
    adminConsole: { mode: 'disabled', slug: 'admin' },
  },
  {
    name: 'single ru disables console',
    locale: 'ru',
    adminConsole: { mode: 'disabled', slug: 'admin' },
  },
  {
    name: 'storybook + console',
    storybook: 'disabled',
    adminConsole: { mode: 'disabled', slug: 'admin' },
  },
  {
    name: 'route-progress + console',
    routeProgress: true,
    adminConsole: { mode: 'host', slug: 'panel' },
  },
  {
    name: 'all dimensions',
    locale: 'en',
    storybook: 'disabled',
    routeProgress: true,
    adminConsole: { mode: 'disabled', slug: 'admin' },
  },
]

describe('init:project plans (structural, against the real repo — read-only)', () => {
  for (const combo of COMBINATIONS) {
    test(`${combo.name}: has no destructive path conflict`, () => {
      assertNoDestructivePathConflict(composedSteps(combo))
    })
  }

  test('regression guard: a move sourced below a deleted parent is rejected', () => {
    const steps = [
      ...composedSteps({ locale: 'en', adminConsole: { mode: 'host', slug: 'panel' } }),
    ]
    steps.push({
      kind: 'move',
      source: path.join(REPO_ROOT, 'apps/web/src/app/[locale]/admin/layout.tsx'),
      target: path.join(REPO_ROOT, 'apps/web/src/app/bad/layout.tsx'),
    })
    assert.throws(() => assertNoDestructivePathConflict(steps))
  })
})
