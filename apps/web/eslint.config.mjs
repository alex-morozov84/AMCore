import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

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

  // Locale-aware navigation.
  //
  // `next/link` and `next/navigation` know nothing about the `[locale]`
  // segment: they drop the prefix silently, sending a Russian user back to the
  // English route with no error anywhere. Because the failure is invisible, it
  // is enforced here rather than left to review. `src/i18n/navigation.ts` is
  // exempt — it is where the locale-aware versions are created.
  {
    name: 'project/i18n-navigation',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/i18n/navigation.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
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
          ],
        },
      ],
    },
  },

  // Validation localization.
  //
  // `z.config(z.locales.*)` sets Zod's locale process-globally. It cannot be
  // scoped to a request or a render (colinhacks/zod#4986), so it cannot serve
  // two live locales and on the server it races across requests. Localize with
  // the per-parse error map instead — `useLocalizedForm` / `useZodErrorMap`.
  {
    name: 'project/zod-locale',
    files: ['src/**/*.{ts,tsx}'],
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

  // No user-facing copy in code.
  //
  // Catches the concrete, mechanical half of the rule: a non-ASCII string
  // literal in `src/` is almost always Russian copy that belongs in a message
  // catalogue. It cannot catch hardcoded *English* copy — that still needs
  // review — but it is what let a half-migrated tree keep shipping Russian
  // beside correct `useTranslations()` calls.
  //
  // Tests and catalogues are exempt: fixtures legitimately contain non-ASCII
  // input, and the catalogues are where the copy is supposed to live.
  {
    name: 'project/no-hardcoded-copy',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
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
