// Console-only edits in shared web files; paths live in the owned-path manifest.
import path from 'node:path'
import { fileStep, jsonDeleteTransform, removeExactBlock } from './init-engine.mjs'

const REGISTER_BLOCK = `export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateAdminConsoleStartupOrExit } = await import('@/shared/lib/admin-console-startup')
    validateAdminConsoleStartupOrExit()
  }
}

`

const LIGHT_TOKEN_BLOCK = `  /* Operations Console: functional control-plane signal, not product primary. */
  --console-accent: #7c3aed;

`

export function removeConsolePackageScript(content) {
  return jsonDeleteTransform(['scripts.test:e2e:console-real-stack'])(content)
}

export function buildAdminConsoleDisableWebSteps(root, { keptLocale } = {}) {
  const catalogueSteps = ['en', 'ru']
    .filter((locale) => !keptLocale || locale === keptLocale)
    .map((locale) =>
      fileStep(
        path.join(root, `apps/web/messages/${locale}.json`),
        jsonDeleteTransform(['console']),
        `remove the ${locale} console message namespace`
      )
    )
  return [
    fileStep(
      path.join(root, 'apps/web/src/instrumentation.ts'),
      (content) => removeExactBlock(content, REGISTER_BLOCK),
      'remove console startup validation from instrumentation'
    ),
    fileStep(
      path.join(root, 'apps/web/src/app/globals.css'),
      (content) =>
        removeExactBlock(
          removeExactBlock(
            removeExactBlock(content, LIGHT_TOKEN_BLOCK),
            '  --console-accent: #7c3aed;\n'
          ),
          '  --color-console-accent: var(--console-accent);\n'
        ),
      'remove the console-only semantic design token'
    ),
    ...catalogueSteps,
    fileStep(
      path.join(root, 'apps/web/package.json'),
      removeConsolePackageScript,
      'remove the console real-stack test command'
    ),
  ]
}
