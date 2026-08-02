import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import boundaries from 'eslint-plugin-boundaries';

// ---------------------------------------------------------------------------
// Feature-Sliced Design boundaries
// ---------------------------------------------------------------------------

// Segment names never occupy the slice position. This exclusion is required
// because `features/auth/login` (group/slice) and `features/locale-switcher/ui`
// (slice/segment) are the same path shape with different meanings — without it
// `ui` and `model` get classified as slices. The grouping under `features/auth`
// is the root cause and is up for review when the pages layer is renamed.
const SEGMENTS = 'ui|model|api|lib|config|hooks|store|pwa|providers|stores';

// Sliced layers are entered through their index only. `shared` is deliberately
// absent: it is a collection of independent modules (`@/shared/ui/button`),
// which is also the only shape the shadcn CLI generates.
const PUBLIC_API = 'index.{ts,tsx}';

const ELEMENTS = [
  { type: 'app', pattern: 'src/app/**/*', partialMatch: false },
  // Not FSD layers, and imported from everywhere. Left unclassified they would
  // either be reported or force `no-unknown`-style classification of every asset.
  { type: 'neutral', pattern: 'src/i18n' },
  { type: 'neutral', pattern: 'src/test' },
  { type: 'neutral', pattern: 'messages' },
  { type: 'pages', pattern: `src/views/*/!(${SEGMENTS})`, capture: ['group', 'slice'] },
  { type: 'pages', pattern: 'src/views/*', capture: ['slice'] },
  { type: 'widgets', pattern: 'src/widgets/*', capture: ['slice'] },
  { type: 'features', pattern: `src/features/*/!(${SEGMENTS})`, capture: ['group', 'slice'] },
  { type: 'features', pattern: 'src/features/*', capture: ['slice'] },
  { type: 'entities', pattern: 'src/entities/*', capture: ['slice'] },
  { type: 'shared', pattern: 'src/shared/*', capture: ['segment'] },
];

/** Layers below may only be entered at their public API. */
const below = (...types) =>
  types.map((type) => ({ element: { type, fileInternalPath: PUBLIC_API } }));

const sharedAndNeutral = [{ element: { type: 'shared' } }, { element: { type: 'neutral' } }];

// A group's own barrel may reach the slices inside it; a slice may not reach a
// sibling slice in another group. Without the captured-value match, allowing
// `features -> features` for the barrel's sake also permits arbitrary
// cross-slice imports — which passes every obvious test case while not guarding.
const sameGroup = (type) => ({
  element: {
    type,
    captured: { group: '{{ from.element.captured.slice }}' },
    fileInternalPath: PUBLIC_API,
  },
});

// `boundaries` cannot see layer-level barrels: `src/features/index.ts` sits
// inside no element, so there is nothing for it to police. Banned here instead.
const LAYER_BARREL = {
  regex: '^@/(features|entities|widgets|views|shared)$',
  message:
    'No layer-level barrels — import the slice public API (@/features/auth/login) ' +
    'or the shared module (@/shared/ui/button). See docs/frontend/.',
};

const NAVIGATION_PATHS = [
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
];

/** @type {import('typescript-eslint').ConfigArray} */
export default [
  // Global ignores
  {
    name: 'project/ignores',
    ignores: ['.next/**', 'out/**', 'build/**', 'node_modules/**', 'public/sw.js'],
  },

  // Base JavaScript rules
  {
    name: 'project/javascript',
    ...js.configs.recommended,
  },

  // TypeScript rules
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    name: 'project/typescript-custom',
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // Import sorting
  {
    name: 'project/import-sort',
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Node.js builtins
            ['^node:'],
            // External packages
            ['^react', '^next', '^@?\\w'],
            // Internal packages (@/)
            ['^@/'],
            // Parent imports
            ['^\\.\\.'],
            // Sibling imports
            ['^\\.'],
            // Style imports
            ['^.+\\.css$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
    },
  },

  // React rules
  {
    name: 'project/react',
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },

  // Accessibility rules
  {
    name: 'project/accessibility',
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      'jsx-a11y': jsxA11yPlugin,
    },
    rules: {
      ...jsxA11yPlugin.configs.recommended.rules,
    },
  },

  // FSD layer direction and slice public API.
  //
  // One rule does both: `boundaries/dependencies` on the current v7 API. The
  // `entry-point` and `element-types` rules that older examples use — including
  // the plugin's own docs page, which still shows the pre-v7 `rules:` key — are
  // deprecated; public API is expressed as `fileInternalPath` on the target.
  // `src/test/eslint-guards.test.ts` fails the build if this config emits any
  // deprecation warning at all.
  {
    name: 'project/fsd-boundaries',
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': ELEMENTS,
      'boundaries/include': ['src/**/*'],
      // Resolves the `@/*` tsconfig paths. `boundaries/alias` would also work
      // but is a legacy setting in v7.
      'import/resolver': { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: {
                to: [
                  { element: { type: 'app' } },
                  ...below('pages', 'widgets', 'features', 'entities'),
                  ...sharedAndNeutral,
                ],
              },
            },
            {
              from: { element: { type: 'pages' } },
              allow: {
                to: [
                  sameGroup('pages'),
                  ...below('widgets', 'features', 'entities'),
                  ...sharedAndNeutral,
                ],
              },
            },
            {
              from: { element: { type: 'widgets' } },
              allow: {
                to: [sameGroup('widgets'), ...below('features', 'entities'), ...sharedAndNeutral],
              },
            },
            {
              from: { element: { type: 'features' } },
              allow: { to: [sameGroup('features'), ...below('entities'), ...sharedAndNeutral] },
            },
            { from: { element: { type: 'entities' } }, allow: { to: sharedAndNeutral } },
            { from: { element: { type: 'shared' } }, allow: { to: sharedAndNeutral } },
            { from: { element: { type: 'neutral' } }, allow: { to: sharedAndNeutral } },
          ],
        },
      ],
    },
  },

  // Import guards — ALL of them, in ONE options object. Same rule as the syntax
  // guards below: a later block configuring `no-restricted-imports` for the same
  // files replaces these options wholesale rather than adding to them.
  {
    name: 'project/import-guards',
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: NAVIGATION_PATHS, patterns: [LAYER_BARREL] }],
    },
  },

  // Deliberate relaxation over a strict subset: `src/i18n/navigation.ts` is
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

  // Syntax guards — ALL of them, in ONE options object. Read this before adding
  // another.
  //
  // ESLint flat config *replaces* a rule's options when a later block
  // configures the same rule key for the same files; it does not merge them.
  // Two blocks that each set `no-restricted-syntax` for `src/**` do not add up
  // — the last one silently wins and the earlier selectors vanish from the
  // effective config with no warning anywhere.
  //
  // That is not hypothetical. The Zod-locale selector below shipped in #267 and
  // was silently disabled the same day by #270, which added the non-ASCII
  // selectors in a second block. It survived only in test files — the one place
  // #270's block was `ignores`d — so it banned `z.config` exactly where nobody
  // writes it and permitted it everywhere that mattered, for as long as nobody
  // checked. `src/test/eslint-guards.test.ts` now fails the build on a repeat.
  //
  // So: one block, one options object, every selector. A narrower block below
  // may relax a selector for a *strict subset* of files — that is the mechanism
  // used deliberately, and the guard test asserts both halves.
  {
    name: 'project/syntax-guards',
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        // Validation localization.
        //
        // `z.config(z.locales.*)` sets Zod's locale process-globally. It cannot
        // be scoped to a request or a render (colinhacks/zod#4986), so it
        // cannot serve two live locales and on the server it races across
        // requests. Localize with the per-parse error map instead —
        // `useLocalizedForm` / `useZodErrorMap`.
        {
          selector:
            "CallExpression[callee.object.name='z'][callee.property.name='config']",
          message:
            'Do not set a global Zod locale — it cannot represent two locales. ' +
            'Use useLocalizedForm() / useZodErrorMap() (per-parse error map).',
        },
        // No user-facing copy in code.
        //
        // Catches the concrete, mechanical half of the rule: a non-ASCII string
        // literal in `src/` is almost always Russian copy that belongs in a
        // message catalogue. It cannot catch hardcoded *English* copy — that
        // still needs review — but it is what let a half-migrated tree keep
        // shipping Russian beside correct `useTranslations()` calls.
        {
          selector: 'Literal[value=/[^\\x00-\\x7F]/]',
          message:
            'Non-ASCII string literal in code — user-facing copy belongs in messages/*.json. ' +
            'See docs/frontend/i18n-and-errors.md.',
        },
        {
          selector: 'TemplateElement[value.raw=/[^\\x00-\\x7F]/]',
          message:
            'Non-ASCII text in a template literal — user-facing copy belongs in messages/*.json. ' +
            'See docs/frontend/i18n-and-errors.md.',
        },
      ],
    },
  },

  // Deliberate relaxation over a STRICT SUBSET of the files above: tests and
  // catalogues legitimately contain non-ASCII fixture input, so only the
  // Zod-locale selector applies there. Because this block replaces the options
  // wholesale (see above), it must restate every selector it still wants — and
  // the guard test asserts exactly that, so dropping one here fails the build.
  {
    name: 'project/syntax-guards-tests',
    files: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='z'][callee.property.name='config']",
          message:
            'Do not set a global Zod locale — it cannot represent two locales. ' +
            'Use useLocalizedForm() / useZodErrorMap() (per-parse error map).',
        },
      ],
    },
  },

  // Next.js rules
  {
    name: 'project/nextjs',
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];
