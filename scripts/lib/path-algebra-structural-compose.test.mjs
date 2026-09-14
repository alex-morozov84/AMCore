import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { planStructuralComposition, applyStructuralPlan } from './path-algebra-structural-compose.mjs'
import { removeTextBlock, replaceTextBlock, assertParsesAsJavaScript } from './path-algebra-text-representation.mjs'

const ESLINT_CONFIG_PATH = fileURLToPath(new URL('../../apps/web/eslint.config.mjs', import.meta.url))
const ESLINT_CONFIG_TEXT = readFileSync(ESLINT_CONFIG_PATH, 'utf8')
const ESLINT_RELATIVE_PATH = 'apps/web/eslint.config.mjs'

// Real text anchors mirroring scripts/lib/project-plan-storybook-eslint.mjs.
// M2 defines its own adapters here (does not import that module) — PR2/M2 is
// additive and must not be wired to the existing engine.
const STORYBOOK_IMPORT_LINE = "import storybookPlugin from 'eslint-plugin-storybook';\n"
const STORYBOOK_IGNORE_ENTRY = "      'storybook-static/**',\n"
const STORYBOOK_RULES_BLOCK = `
  // Storybook rules — story-file/\`.storybook/main.ts\` linting from the
  // plugin's own recommended flat config, not hand-restated here.
  ...storybookPlugin.configs['flat/recommended'],
`

function registerRemoveStorybook(registry) {
  registry.define('remove-storybook-eslint', {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [{ location: 'eslint-config:storybook-plugin', value: 'absent' }],
    adapter: (text, params, ctx) => {
      let next = removeTextBlock(text, STORYBOOK_IMPORT_LINE, ctx)
      next = removeTextBlock(next, STORYBOOK_IGNORE_ENTRY, ctx)
      return removeTextBlock(next, STORYBOOK_RULES_BLOCK, ctx)
    },
  })
}

// Real text anchors mirroring scripts/lib/project-plan-web-config.mjs's
// removeNavigationBanFromEslintConfig — same additive-only rationale.
const NAV_PATHS_BLOCK = `const NAVIGATION_PATHS = [
  {
    name: 'next/link',
    message: "Import { Link } from '@/i18n/navigation' — next/link drops the locale.",
  },
  {
    name: 'next/navigation',
    importNames: ['redirect', 'permanentRedirect', 'usePathname', 'useRouter'],
    message:
      "Import locale-aware navigation from '@/i18n/navigation'. " +
      'Non-navigating helpers such as notFound() may still come from next/navigation.',
  },
  {
    name: '@/i18n/navigation',
    importNames: ['useRouter', 'Link'],
    message:
      "Import { useRouteProgressRouter } from " +
      "'@/shared/lib/route-progress/use-route-progress-router' for useRouter(), or " +
      "{ RouteProgressLink } from '@/shared/ui/route-progress-link' for Link — the raw " +
      'exports bypass the route progress bar. Other exports (usePathname, redirect, ...) ' +
      "still come from '@/i18n/navigation' directly.",
  },
];

`
const NAV_SOURCE_EXEMPTION_BLOCK = `  // Deliberate relaxation over a strict subset: \`src/i18n/navigation.ts\` is
  // where the locale-aware navigation helpers are created, so it is the one
  // file that must import the originals. It restates the layer-barrel pattern,
  // which still applies to it.
  {
    name: 'project/import-guards-navigation-source',
    files: ['src/i18n/navigation.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LAYER_BARREL] }],
    },
  },

  // Same relaxation, narrower: \`use-route-progress-router.ts\` is the one file
  // allowed to call \`@/i18n/navigation\`'s real \`useRouter()\` — that is its
  // entire job (FINAL PLAN item 6). The layer-barrel pattern still applies.
  {
    name: 'project/import-guards-route-progress-router-adapter',
    files: ['src/shared/lib/route-progress/use-route-progress-router.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LAYER_BARREL] }],
    },
  },

  // Same relaxation, for \`Link\`: \`route-progress-link.tsx\` is the one file
  // allowed to import \`@/i18n/navigation\`'s real \`Link\` (reconverged FINAL
  // PLAN item 5, 2026-09-10, Agent 2 diff review) — that is its entire job.
  {
    name: 'project/import-guards-route-progress-link-adapter',
    files: ['src/shared/ui/route-progress-link.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LAYER_BARREL] }],
    },
  },

`
const NAV_RESTRICTED_IMPORTS_BEFORE =
  "      'no-restricted-imports': ['error', { paths: NAVIGATION_PATHS, patterns: [LAYER_BARREL] }],\n"
const NAV_RESTRICTED_IMPORTS_AFTER = "      'no-restricted-imports': ['error', { patterns: [LAYER_BARREL] }],\n"

function registerRemoveNavigationBan(registry) {
  registry.define('remove-navigation-ban-eslint', {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [{ location: 'eslint-config:navigation-ban', value: 'absent' }],
    adapter: (text, params, ctx) => {
      let next = removeTextBlock(text, NAV_PATHS_BLOCK, ctx)
      next = removeTextBlock(next, NAV_SOURCE_EXEMPTION_BLOCK, ctx)
      return replaceTextBlock(next, NAV_RESTRICTED_IMPORTS_BEFORE, NAV_RESTRICTED_IMPORTS_AFTER, ctx)
    },
  })
}

// A third, real, disjoint anchor in the same real file — not tied to any
// existing CLI flag, added only to exercise 3-way composition.
const MOCK_SERVICE_WORKER_IGNORE_ENTRY = "      'public/mockServiceWorker.js',\n"

function registerRemoveMockServiceWorkerIgnore(registry) {
  registry.define('remove-msw-ignore-eslint', {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [{ location: 'eslint-config:msw-ignore-entry', value: 'absent' }],
    adapter: (text, params, ctx) => removeTextBlock(text, MOCK_SERVICE_WORKER_IGNORE_ENTRY, ctx),
  })
}

function planAndApply(registry, facts, initialText) {
  const [plan] = planStructuralComposition(registry, facts)
  const result = applyStructuralPlan(registry, plan, initialText)
  assertParsesAsJavaScript(result, { path: plan.path, operationKey: 'compose-result' })
  return result
}

test('real two-operation composition of eslint.config.mjs with zero combined adapter', () => {
  const registry = createOperationRegistry()
  registerRemoveStorybook(registry)
  registerRemoveNavigationBan(registry)
  const facts = [
    { dimension: 'storybook', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-storybook-eslint', params: {} },
    { dimension: 'nav-guard', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-navigation-ban-eslint', params: {} },
  ]
  const result = planAndApply(registry, facts, ESLINT_CONFIG_TEXT)
  assert.ok(!result.includes(STORYBOOK_IMPORT_LINE))
  assert.ok(!result.includes(STORYBOOK_RULES_BLOCK))
  assert.ok(!result.includes(NAV_PATHS_BLOCK))
  assert.ok(result.includes(NAV_RESTRICTED_IMPORTS_AFTER))
})

test('real three-operation composition of eslint.config.mjs with zero combined adapter', () => {
  const registry = createOperationRegistry()
  registerRemoveStorybook(registry)
  registerRemoveNavigationBan(registry)
  registerRemoveMockServiceWorkerIgnore(registry)
  const facts = [
    { dimension: 'storybook', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-storybook-eslint', params: {} },
    { dimension: 'nav-guard', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-navigation-ban-eslint', params: {} },
    { dimension: 'msw', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-msw-ignore-eslint', params: {} },
  ]
  const result = planAndApply(registry, facts, ESLINT_CONFIG_TEXT)
  assert.ok(!result.includes(STORYBOOK_IMPORT_LINE))
  assert.ok(!result.includes(NAV_PATHS_BLOCK))
  assert.ok(!result.includes(MOCK_SERVICE_WORKER_IGNORE_ENTRY))
})

test('composition result does not depend on fact array order', () => {
  const registry = createOperationRegistry()
  registerRemoveStorybook(registry)
  registerRemoveNavigationBan(registry)
  registerRemoveMockServiceWorkerIgnore(registry)
  const facts = [
    { dimension: 'storybook', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-storybook-eslint', params: {} },
    { dimension: 'nav-guard', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-navigation-ban-eslint', params: {} },
    { dimension: 'msw', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-msw-ignore-eslint', params: {} },
  ]
  const forward = planAndApply(registry, facts, ESLINT_CONFIG_TEXT)
  const reversed = planAndApply(registry, [...facts].reverse(), ESLINT_CONFIG_TEXT)
  assert.equal(forward, reversed)
})

test('missing semantic anchor propagates through composition before any write', () => {
  const registry = createOperationRegistry()
  registry.define('remove-nonexistent', {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [{ location: 'nowhere', value: 'absent' }],
    adapter: (text, params, ctx) => removeTextBlock(text, 'THIS_TEXT_DOES_NOT_EXIST', ctx),
  })
  const facts = [{ dimension: 'd', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-nonexistent', params: {} }]
  const [plan] = planStructuralComposition(registry, facts)
  assert.throws(() => applyStructuralPlan(registry, plan, ESLINT_CONFIG_TEXT), /missing-anchor/)
})

test('ambiguous semantic anchor propagates through composition before any write', () => {
  const registry = createOperationRegistry()
  registry.define('remove-ambiguous', {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [{ location: 'nowhere', value: 'absent' }],
    adapter: (text, params, ctx) => removeTextBlock(text, "'no-restricted-imports'", ctx),
  })
  const facts = [{ dimension: 'd', path: ESLINT_RELATIVE_PATH, operationKey: 'remove-ambiguous', params: {} }]
  const [plan] = planStructuralComposition(registry, facts)
  assert.throws(() => applyStructuralPlan(registry, plan, ESLINT_CONFIG_TEXT), /ambiguous-anchor/)
})

test('an adapter producing invalid JavaScript fails with invalid-output-parse before any write', () => {
  const registry = createOperationRegistry()
  registry.define('corrupt-output', {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [{ location: 'nowhere', value: 'absent' }],
    adapter: (text, params, ctx) => {
      const corrupted = text.replace('export default', 'export default (((')
      assertParsesAsJavaScript(corrupted, ctx)
      return corrupted
    },
  })
  const facts = [{ dimension: 'd', path: ESLINT_RELATIVE_PATH, operationKey: 'corrupt-output', params: {} }]
  const [plan] = planStructuralComposition(registry, facts)
  assert.throws(() => applyStructuralPlan(registry, plan, ESLINT_CONFIG_TEXT), /invalid-output-parse/)
})
