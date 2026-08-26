// Path/option tables for init-brand, factored out of brand-plan.mjs and
// brand-fields.mjs so both (and their tests, against a scratch fixture
// root) resolve the same target files the same way.
import path from 'node:path'

export function resolvePaths(root) {
  return {
    projectContext: path.join(root, 'PROJECT_CONTEXT.md'),
    rootPackageJson: path.join(root, 'package.json'),
    manifest: path.join(root, 'apps/web/src/app/manifest.ts'),
    theme: path.join(root, 'apps/web/src/shared/lib/theme.ts'),
    enMessages: path.join(root, 'apps/web/messages/en.json'),
    ruMessages: path.join(root, 'apps/web/messages/ru.json'),
    logoDark: path.join(root, 'apps/web/public/logo-dark.png'),
    logoLight: path.join(root, 'apps/web/public/logo-light.png'),
  }
}

export function resolveIconSpecs(root) {
  return [
    {
      answerKey: 'icon192Src',
      flag: 'icon-192',
      dest: path.join(root, 'apps/web/public/icons/icon-192x192.png'),
      width: 192,
      height: 192,
    },
    {
      answerKey: 'icon512Src',
      flag: 'icon-512',
      dest: path.join(root, 'apps/web/public/icons/icon-512x512.png'),
      width: 512,
      height: 512,
    },
    {
      answerKey: 'icon512MaskableSrc',
      flag: 'icon-512-maskable',
      dest: path.join(root, 'apps/web/public/icons/icon-512x512-maskable.png'),
      width: 512,
      height: 512,
    },
  ]
}

export const WORKFLOW_MODES = ['strict', 'flexible', 'custom']
export const THEME_MODES = ['system', 'light', 'dark']
export const THEME_PERSISTENCE_MODES = ['local-storage', 'cookie-ssr']
