const one = (path, extra = {}) => ({ path, kind: 'file', cardinality: 'one', ...extra })
const dir = (path) => ({ path, kind: 'directory', cardinality: 'one' })
const many = (glob, extra = {}) => ({
  glob,
  kind: 'file',
  cardinality: 'one-or-more',
  ...extra,
})

export const STORYBOOK_STORY_GLOB = 'apps/web/src/**/*.stories.tsx'

export const storybookFacts = {
  roots: [dir('apps/web/.storybook')],
  featureFiles: [],
  sharedModules: [],
  sharedModuleTests: [],
  topology: [],
  verification: [many(STORYBOOK_STORY_GLOB, { tags: ['verification:storybook'] })],
  documentation: [one('docs/frontend/storybook.md')],
  featureEntrypoints: [],
  repositoryEntrypoints: [],
}

export const storybookSurfaceRoots = [
  'apps/web/.gitignore',
  'apps/web/.storybook',
  'apps/web/Dockerfile',
  'apps/web/components.json',
  'apps/web/e2e',
  'apps/web/eslint.config.mjs',
  'apps/web/messages',
  'apps/web/next.config.ts',
  'apps/web/package.json',
  'apps/web/playwright.config.ts',
  'apps/web/playwright.console-real-stack.config.ts',
  'apps/web/playwright.real-stack.config.ts',
  'apps/web/postcss.config.mjs',
  'apps/web/public',
  'apps/web/src',
  'apps/web/stylelint.config.mjs',
  'apps/web/tsconfig.json',
  'apps/web/vitest.config.ts',
  'apps/web/vitest.integration.config.ts',
  'apps/web/vitest.shims.d.ts',
  '.github/workflows',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'PROJECT_CONTEXT.md',
  'README.md',
  'docs',
]
