import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';
import storybookPlugin from 'eslint-plugin-storybook';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import simpleImportSort from 'eslint-plugin-simple-import-sort';
import boundaries from 'eslint-plugin-boundaries';

// ---------------------------------------------------------------------------
// Feature-Sliced Design boundaries
// ---------------------------------------------------------------------------

// Segment names never occupy the slice position. This exclusion is required
// because a grouped page such as `_pages/auth/LoginPage` (group/slice) and a
// flat slice's own segment folder (slice/segment) would be the same path
// shape with different meanings — without it `ui`/`model` could get
// classified as a slice. `features` no longer needs this: Track 9 flattened
// `features/auth/*` and `features/sessions/*`, the only two feature groups,
// so every feature is now a flat, single-level slice matching
// `widgets`/`entities`'s shape below.
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
  { type: 'pages', pattern: `src/_pages/*/!(${SEGMENTS})`, capture: ['group', 'slice'] },
  { type: 'pages', pattern: 'src/_pages/*', capture: ['slice'] },
  { type: 'widgets', pattern: 'src/widgets/*', capture: ['slice'] },
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
  regex: '^@/(features|entities|widgets|_pages|shared)$',
  message:
    'No layer-level barrels — import the slice public API (@/features/auth-login) ' +
    'or the shared module (@/shared/ui/button). See docs/frontend/.',
};

// ---------------------------------------------------------------------------
// Token-only styling
// ---------------------------------------------------------------------------
//
// The palette is the *source* for tokens; `globals.css` maps it into semantic
// names. Components consume the tokens only. Two ways to reach past them, and
// each is banned where it can actually be seen:
//
//   1. a default-palette utility  — `bg-red-500`, `dark:text-gray-800`
//   2. a raw colour in an arbitrary value — `bg-[#8b5cf6]`, `text-[rgb(…)]`
//
// Tailwind can delete the palette (`--color-*: initial`) but has no supported
// way to disable arbitrary values, so lint is the only place invariant 2 can
// live. Inline `style` is handled by `react/forbid-dom-props`, not here.

/**
 * Hue names read from the installed Tailwind, never listed by hand.
 *
 * A hand-written list was tried first and was already wrong: 4.3.3 ships
 * `mauve`, `mist`, `olive` and `taupe`, so `bg-mauve-500` passed a rule that
 * looked complete. Reading the source means a Tailwind upgrade extends the ban
 * on its own, and a restructure fails loudly here instead of silently opening
 * a hole.
 */
function tailwindHues() {
  const themePath = fileURLToPath(import.meta.resolve('tailwindcss/theme.css'));
  const hues = new Set(
    [...readFileSync(themePath, 'utf8').matchAll(/^\s*--color-([a-z]+)-\d+:/gm)].map((m) => m[1]),
  );

  if (hues.size === 0) {
    throw new Error(
      `No default palette found in ${themePath}. Tailwind changed how the theme is published; ` +
        'the token-only styling rule cannot be built and would otherwise pass silently.',
    );
  }

  return [...hues].join('|');
}

// `[^a-z-]` rather than a whitespace anchor, so variant prefixes are covered:
// `hover:bg-red-500`, `dark:text-gray-800`, `[&>*]:bg-red-50`. The scale suffix
// is what separates a palette colour from a token — `bg-destructive` and
// `text-chart-1` have no `-500`.
const PALETTE_CLASS = `(^|[^a-z-])[a-z-]+-(${tailwindHues()})-(50|[1-9]00|950)\\b`;
const PALETTE_MESSAGE =
  "Tailwind's default palette bypasses the theme — use a semantic token " +
  '(bg-destructive, text-muted-foreground). See docs/frontend/brand-theme-and-tokens.md.';

// Keyed on the value, with no list of colour utilities: `-[#…]` is a colour
// wherever it appears, so `ring-`, `divide-` and any utility a future Tailwind
// adds are covered without maintaining a list. `w-[32px]` does not match, and
// `bg-[var(--brand)]` stays legal because a variable is a token reference.
const ARBITRARY_COLOUR = '-\\[(#|rgba?\\(|hsla?\\(|oklch\\(|lab\\(|lch\\(|color\\()';
const ARBITRARY_MESSAGE =
  'Raw colour in a Tailwind arbitrary value — use a semantic token, or a CSS variable ' +
  'if the value must be computed. See docs/frontend/brand-theme-and-tokens.md.';

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
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'public/sw.js',
      'public/mockServiceWorker.js',
      'storybook-static/**',
    ],
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
      // Inline styles cannot follow the theme, and a rule that tried to allow
      // "only non-colour" inline styles turned into a hand-maintained list of
      // CSS colour properties — the fragile shape this track exists to avoid.
      // The whole prop is banned instead, using a rule someone else maintains.
      // A genuinely dynamic value becomes one `eslint-disable` line with a
      // reason, which is reviewable; a regex silently deciding what counts as
      // a colour is not. The tree has no inline styles today.
      'react/forbid-dom-props': [
        'error',
        {
          forbid: [
            {
              propName: 'style',
              message:
                'Inline styles cannot follow the theme — use token utilities. ' +
                'See docs/frontend/brand-theme-and-tokens.md.',
            },
          ],
        },
      ],
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
        // Token-only styling — see the block comment at the top of this file.
        // Scanned on every string literal rather than only JSX, because class
        // strings also live in plain objects: the `cva()` variants in
        // `shared/ui/button.tsx` are the likeliest place for a raw colour.
        { selector: `Literal[value=/${PALETTE_CLASS}/]`, message: PALETTE_MESSAGE },
        { selector: `TemplateElement[value.raw=/${PALETTE_CLASS}/]`, message: PALETTE_MESSAGE },
        { selector: `Literal[value=/${ARBITRARY_COLOUR}/]`, message: ARBITRARY_MESSAGE },
        { selector: `TemplateElement[value.raw=/${ARBITRARY_COLOUR}/]`, message: ARBITRARY_MESSAGE },
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

  // Storybook rules — story-file/`.storybook/main.ts` linting from the
  // plugin's own recommended flat config, not hand-restated here.
  ...storybookPlugin.configs['flat/recommended'],
];
