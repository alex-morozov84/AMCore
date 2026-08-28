// init:project --mode=single steps that rewrite apps/web config files in
// place (no move): i18n/request.ts (next-intl's "without i18n routing"
// setup) and eslint.config.mjs (the navigation-import ban and its
// navigation.ts-scoped exemption, both meaningless once that file and the
// [locale] segment are gone).
import path from 'node:path'
import { fileStep, exactContentStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const REQUEST_BEFORE = `import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'

import { routing } from './routing'

/**
 * Shared format definitions. Declaring them once here (rather than passing
 * options at each call site) keeps date/number rendering consistent and makes
 * the names type-checked via the \`Formats\` entry in \`AppConfig\` — see
 * \`src/global.d.ts\`.
 */
export const formats = {
  dateTime: {
    short: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: 'numeric' },
  },
  number: {
    precise: { maximumFractionDigits: 2 },
  },
} as const

export default getRequestConfig(async ({ requestLocale }) => {
  // \`requestLocale\` carries the \`[locale]\` segment. Validate it against the
  // shared locale set rather than trusting the URL — the segment is user input
  // and would otherwise be used to index the message catalogue directly.
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    formats,
    messages: (await import(\`../../messages/\${locale}.json\`)).default,
  }
})
`

const REQUEST_AFTER = `import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_LOCALE } from '@amcore/shared'

/**
 * Shared format definitions. Declaring them once here (rather than passing
 * options at each call site) keeps date/number rendering consistent and makes
 * the names type-checked via the \`Formats\` entry in \`AppConfig\` — see
 * \`src/global.d.ts\`.
 */
export const formats = {
  dateTime: {
    short: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: 'numeric' },
  },
  number: {
    precise: { maximumFractionDigits: 2 },
  },
} as const

// Single-locale mode (pnpm init:project --mode=single): no [locale] route
// segment exists, so there is nothing to read from the request — every
// render uses the one supported locale. See next-intl's "without i18n
// routing" setup.
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  formats,
  messages: (await import(\`../../messages/\${DEFAULT_LOCALE}.json\`)).default,
}))
`

const NAVIGATION_PATHS_BLOCK = `const NAVIGATION_PATHS = [
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

`

const NAVIGATION_SOURCE_EXEMPTION_BLOCK = `  // Deliberate relaxation over a strict subset: \`src/i18n/navigation.ts\` is
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

`

/**
 * Exported on its own (not just a buildWebConfigSteps closure) so
 * project-plan-combined.mjs can compose it with
 * removeStorybookFromEslintConfig into one fileStep when --mode and
 * --storybook are both given — see that file's header for why two
 * independent fileSteps on the same target silently clobber each other.
 */
export function removeNavigationBanFromEslintConfig(content) {
  let next = removeExactBlock(content, NAVIGATION_PATHS_BLOCK)
  next = removeExactBlock(next, NAVIGATION_SOURCE_EXEMPTION_BLOCK)
  return replaceExactBlock(
    next,
    "      'no-restricted-imports': ['error', { paths: NAVIGATION_PATHS, patterns: [LAYER_BARREL] }],\n",
    "      'no-restricted-imports': ['error', { patterns: [LAYER_BARREL] }],\n"
  )
}

export function buildWebConfigSteps(root) {
  const requestPath = path.join(root, 'apps/web/src/i18n/request.ts')
  const eslintPath = path.join(root, 'apps/web/eslint.config.mjs')

  return [
    exactContentStep(
      requestPath,
      { expectedBefore: REQUEST_BEFORE, after: REQUEST_AFTER },
      'rewrite i18n/request.ts to return a static locale (next-intl "without i18n routing")'
    ),
    fileStep(
      eslintPath,
      removeNavigationBanFromEslintConfig,
      'remove the navigation-import ban and its navigation.ts-scoped exemption'
    ),
  ]
}
