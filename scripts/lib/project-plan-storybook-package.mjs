// init:project --storybook=disabled: apps/web/package.json's Storybook-only
// scripts and devDependencies. `path-to-regexp` is included even though it
// isn't a Storybook package itself -- its only reason to exist in this
// file is vitest.config.ts's storybook project's optimizeDeps.include
// (removed by project-plan-storybook-config.mjs), and nothing else in
// apps/web imports it.
import path from 'node:path'
import { fileStep, jsonDeleteTransform } from './init-engine.mjs'

const SCRIPT_PATHS = ['scripts.test:storybook', 'scripts.storybook', 'scripts.build-storybook']

const DEV_DEPENDENCY_PATHS = [
  'devDependencies.@storybook/addon-a11y',
  'devDependencies.@storybook/addon-docs',
  'devDependencies.@storybook/addon-themes',
  'devDependencies.@storybook/addon-vitest',
  'devDependencies.@storybook/nextjs-vite',
  'devDependencies.@vitest/browser-playwright',
  'devDependencies.eslint-plugin-storybook',
  'devDependencies.msw-storybook-addon',
  'devDependencies.storybook',
  'devDependencies.path-to-regexp',
]

export function buildStorybookPackageSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/package.json'),
      jsonDeleteTransform([...SCRIPT_PATHS, ...DEV_DEPENDENCY_PATHS]),
      'apps/web/package.json: remove the Storybook scripts and devDependencies'
    ),
  ]
}
