// Exact reviewed adapters; the sender is the only server raw-fetch exception.
export const RAW_FETCH_FILES = [
  'src/shared/api/backend-transport.ts',
  'src/shared/api/http-client.ts',
  'src/entities/api-key/api/own-api-keys-client.ts',
  ...['creation', 'invitations', 'member-api-keys', 'member-removal', 'members', 'roles'].map(
    (name) => `src/entities/organization-context/api/${name}-client.ts`
  ),
  // AMCORE_CONSOLE_NETWORK_EXCEPTIONS_START
  'src/shared/api/console/establishment-client.ts',
  'src/shared/api/console/identity-lookup-client.ts',
  'src/shared/api/console/provisioning-client.ts',
  // AMCORE_CONSOLE_NETWORK_EXCEPTIONS_END
  'src/shared/lib/deployment-version/checker.ts',
]
const extensions = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}'
const files = [`src/**/*.${extensions}`]
const ignores = [
  ...['test', 'spec', 'stories'].map((kind) => `src/**/*.${kind}.${extensions}`),
  'src/**/*.d.{ts,mts,cts}',
  'src/test/**',
]
const message =
  'Use fetchBackendResponse with original request headers on the server, fetchBackend for reads, ' +
  'or the existing browser apiClient. See docs/frontend/api-consumption.md.'
const modules = ['undici', 'node-fetch', 'axios', 'http', 'https', 'node:http', 'node:https']
export const NETWORK_IMPORTS = modules.map((name) => ({
  group: [name, `${name}/*`],
  allowTypeImports: true,
  message,
}))
const modulePattern = '^(undici|node-fetch|axios|http|https|node:http|node:https)(\\/|$)'
export const NETWORK_LOADERS = [
  `ImportExpression > Literal.source[value=/${modulePattern}/]`,
  `CallExpression[callee.name='require'] > Literal.arguments[value=/${modulePattern}/]`,
  `ImportExpression > TemplateLiteral.source > TemplateElement[value.raw=/${modulePattern}/]`,
  `CallExpression[callee.name='require'] > TemplateLiteral.arguments > TemplateElement[value.raw=/${modulePattern}/]`,
  `TSImportEqualsDeclaration[importKind!='type'] > TSExternalModuleReference > Literal.expression[value=/${modulePattern}/]`,
].map((selector) => ({ selector, message }))
export const networkPolicy = [
  {
    name: 'project/network-source-parser',
    files,
    languageOptions: {
      globals: {
        fetch: 'readonly',
        window: 'readonly',
        self: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
      },
    },
  },
  {
    name: 'project/network-fetch',
    files,
    ignores: [...ignores, ...RAW_FETCH_FILES],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          globals: [{ name: 'fetch', message }],
          checkGlobalObject: true,
          globalObjects: ['globalThis', 'window', 'self', 'global'],
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'fetch', message },
        {
          property: 'API_URL',
          message: 'Use getBackendBaseUrl(). See docs/frontend/api-consumption.md.',
        },
      ],
    },
  },
  {
    name: 'project/network-browser-base',
    files: RAW_FETCH_FILES.slice(1),
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'API_URL',
          message: 'Use getBackendBaseUrl(). See docs/frontend/api-consumption.md.',
        },
      ],
    },
  },
]
