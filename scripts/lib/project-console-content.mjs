import ts from 'typescript'

import { findUniqueNode, isImportOf } from './path-algebra-ast-query.mjs'
import { replaceExactBlock } from './content-blocks.mjs'
import { consoleOwnedBlockDefinition } from './project-console-doc-content.mjs'
import { projectConsoleProxyDefinition } from './project-console-proxy-content.mjs'

const CONFIG_DEFAULT = `  enabled: true,
  mode: 'path',
  slug: 'admin',`
const LIGHT_TOKENS = `  /* Operations Console: functional control-plane signal, not product primary. */
  --console-accent: #7c3aed;

`

const absent = (location) => ({ location, value: 'absent' })
const noParams = (params) => params && Object.keys(params).length === 0

function removeStartup(model, _params, ctx) {
  const node = findUniqueNode(
    model,
    (candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === 'register',
    { ...ctx, describe: 'register function' }
  )
  model.removeNode(node, ctx)
}

function rewriteLogin(model, _params, ctx) {
  for (const moduleName of ['next-intl/server', '@/i18n/params']) {
    const node = findUniqueNode(model, (candidate) => isImportOf(candidate, moduleName), {
      ...ctx,
      describe: `import of "${moduleName}"`,
    })
    model.removeNode(node, ctx)
  }
  const fn = findUniqueNode(
    model,
    (candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === 'ConsoleLogin',
    { ...ctx, describe: 'ConsoleLogin function' }
  )
  model.replaceNode(
    fn,
    `export default async function ConsoleLogin() {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') notFound()
  return <ConsoleLoginPage />
}`,
    ctx
  )
}

export function registerConsoleStructuralOperations(registry) {
  registry.define('console.startup-hook', {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [absent('ts:function:register:console-startup')],
    adapter: removeStartup,
  })
  registry.define('console.login-single-locale', {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [
      absent('ts:import:next-intl/server'),
      absent('ts:import:@/i18n/params'),
      { location: 'ts:function:ConsoleLogin:locale', value: 'independent' },
    ],
    adapter: rewriteLogin,
  })
}

function runtimeConfig(text, { mode, slug }) {
  return replaceExactBlock(
    text,
    CONFIG_DEFAULT,
    `  enabled: true,\n  mode: '${mode}',\n  slug: '${slug}',`
  )
}

function removeTokens(text) {
  return replaceExactBlock(
    replaceExactBlock(
      replaceExactBlock(text, LIGHT_TOKENS, ''),
      '  --console-accent: #7c3aed;\n',
      ''
    ),
    '  --color-console-accent: var(--console-accent);\n',
    ''
  )
}

const definitions = new Map([
  [
    'console.runtime-config',
    {
      claims: ({ mode, slug }) => [
        { location: 'ts:ADMIN_CONSOLE_CONFIG.mode', value: mode },
        { location: 'ts:ADMIN_CONSOLE_CONFIG.slug', value: slug },
      ],
      apply: runtimeConfig,
    },
  ],
  ['console.tokens', { claims: () => [absent('css:token:console-accent')], apply: removeTokens }],
  [
    'console.compose-env',
    {
      claims: () => [absent('yaml:services.web.environment.ADMIN_CONSOLE_HOSTNAME')],
      apply: (text) =>
        replaceExactBlock(text, '      ADMIN_CONSOLE_HOSTNAME: ${ADMIN_CONSOLE_HOSTNAME:-}\n', ''),
    },
  ],
])

export function projectConsoleContentDefinition(operationKey) {
  return (
    definitions.get(operationKey) ??
    projectConsoleProxyDefinition(operationKey) ??
    consoleOwnedBlockDefinition(operationKey)
  )
}
