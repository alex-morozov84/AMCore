// Residual ESLint syntax policy: namespace/dynamic intl loads are deliberately
// rejected rather than attempting to follow arbitrary bindings or reflected access.
const entry = '/^(next-intl|use-intl|use-intl\\/react)$/'
const names = '/^(NextIntlClientProvider|IntlProvider|useMessages)$/'
const message =
  'Select client messages through i18n/client-message-boundary. See docs/frontend/i18n-and-errors.md.'
const catalogue =
  'Load runtime catalogues only in i18n/request.ts; select namespaces at the server composition boundary.'

export const PROVIDER_SYNTAX = [
  `ImportDeclaration[importKind!='type'][source.value=${entry}] > ImportSpecifier[importKind!='type'][imported.name=${names}]`,
  `ImportDeclaration[importKind!='type'][source.value=${entry}] > ImportNamespaceSpecifier`,
  `ExportNamedDeclaration[exportKind!='type'][source.value=${entry}] > ExportSpecifier[exportKind!='type'][local.name=${names}]`,
  `ExportAllDeclaration[exportKind!='type'][source.value=${entry}]`,
  `ImportExpression > Literal.source[value=${entry}]`,
  `ImportExpression > TemplateLiteral.source[expressions.length=0] > TemplateElement[value.raw=${entry}]`,
  `CallExpression[callee.name='require'] > Literal.arguments[value=${entry}]`,
  `CallExpression[callee.name='require'] > TemplateLiteral.arguments[expressions.length=0] > TemplateElement[value.raw=${entry}]`,
].map((selector) => ({ selector, message }))

const privateModule = '/(^|\\/)(client-message-provider|client-messages)(\\.[cm]?[jt]sx?)?$/'
export const PRIVATE_MESSAGE_SYNTAX = [
  `ImportDeclaration[importKind!='type'][source.value=${privateModule}] > ImportSpecifier[importKind!='type']`,
  `ImportDeclaration[importKind!='type'][source.value=${privateModule}] > :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)`,
  `ImportDeclaration[importKind!='type'][specifiers.length=0][source.value=${privateModule}]`,
  `ExportNamedDeclaration[exportKind!='type'][source.value=${privateModule}] > ExportSpecifier[exportKind!='type']`,
  `ExportAllDeclaration[exportKind!='type'][source.value=${privateModule}]`,
  `ImportExpression > Literal.source[value=${privateModule}]`,
  `ImportExpression > TemplateLiteral.source[expressions.length=0] > TemplateElement[value.raw=${privateModule}]`,
].map((selector) => ({ selector, message }))

const path = '/(^|\\/)messages\\/.*\\.json$/'
export const CATALOGUE_SYNTAX = [
  `ImportDeclaration[importKind!='type'][source.value=${path}]:not(:has(ImportSpecifier)):not(:has(ImportDefaultSpecifier[importKind='type']))`,
  `ImportDeclaration[importKind!='type'][source.value=${path}] > ImportSpecifier[importKind!='type']`,
  `ImportDeclaration[importKind!='type'][source.value=${path}] > ImportDefaultSpecifier`,
  `ExportNamedDeclaration[exportKind!='type'][source.value=${path}] > ExportSpecifier[exportKind!='type']`,
  `ExportAllDeclaration[exportKind!='type'][source.value=${path}]`,
  `ImportExpression > Literal.source[value=${path}]`,
  // A template path such as messages/${locale}.json is runtime catalogue loading too.
  `ImportExpression > TemplateLiteral.source:has(TemplateElement[value.raw=/messages\\//])`,
  `CallExpression[callee.name='require'] > Literal.arguments[value=${path}]`,
].map((selector) => ({ selector, message: catalogue }))

export const MESSAGE_BOUNDARY_FILES = [
  'src/i18n/client-message-boundary.tsx',
  'src/i18n/client-message-provider.tsx',
]
export const MESSAGE_FIXTURES = [
  'src/**/*.{test,spec,stories}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  'src/**/*.d.{ts,mts,cts}',
  'src/test/**',
]
