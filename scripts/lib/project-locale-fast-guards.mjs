import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { buildProjectLocaleFacts } from './project-locale-facts.mjs'
import { LOCALE_DELETES } from './project-locale-route-paths.mjs'

const NAVIGATION = '@/i18n/navigation'
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const FIXTURE = /\.(?:test|spec|stories)\.[jt]sx?$/
const LOCALE_STATE = { selected: { locale: true }, locale: { mode: 'single', base: 'en' } }

function walk(root, relative = 'apps/web') {
  const directory = path.join(root, relative)
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(relative, entry.name)
    if (entry.isDirectory()) return walk(root, target)
    return entry.isFile() && SOURCE.test(entry.name) ? [target] : []
  })
}

function registeredPaths(prefix) {
  return new Set(
    buildProjectLocaleFacts(LOCALE_STATE)
      .filter((fact) => fact.operationKey?.startsWith(prefix))
      .map((fact) => fact.path)
  )
}

function navigationReferences(source) {
  const references = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === NAVIGATION
    ) {
      references.push('import')
    }
    const [argument] = ts.isCallExpression(node) ? node.arguments : []
    if (
      ts.isCallExpression(node) &&
      argument &&
      ts.isStringLiteral(argument) &&
      argument.text === NAVIGATION
    ) {
      const expression = node.expression
      const mock =
        ts.isPropertyAccessExpression(expression) &&
        ['vi', 'jest'].includes(expression.expression.getText()) &&
        expression.name.text === 'mock'
      references.push(mock ? 'mock' : 'call')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return references
}

function providerLiteral(node) {
  if (!ts.isJsxAttribute(node) || node.name.text !== 'locale') return false
  const initializer = node.initializer
  const literal =
    initializer && ts.isStringLiteral(initializer)
      ? initializer
      : initializer && ts.isJsxExpression(initializer) && ts.isStringLiteral(initializer.expression)
        ? initializer.expression
        : undefined
  return (
    literal &&
    node.parent.parent.tagName.getText() === 'NextIntlClientProvider' &&
    literal.text
  )
}

function typedFixtureLiteral(node, file) {
  if (
    !FIXTURE.test(file) ||
    !ts.isPropertyAssignment(node) ||
    !ts.isIdentifier(node.name) ||
    node.name.text !== 'locale'
  ) {
    return false
  }
  if (!ts.isStringLiteral(node.initializer)) return false
  const object = node.parent
  const container = object.parent
  const type =
    ts.isVariableDeclaration(container) || ts.isAsExpression(container) || ts.isSatisfiesExpression(container)
      ? container.type
      : undefined
  return ts.isObjectLiteralExpression(object) && /\b(?:Supported)?Locale\b/.test(type?.getText() ?? '')
}

function fixtureLiterals(source, file) {
  const literals = []
  const visit = (node) => {
    const provider = providerLiteral(node)
    if (provider || typedFixtureLiteral(node, file)) {
      literals.push(provider || node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return literals
}

function failuresForFile(root, file, navigationFacts, localeFacts) {
  const text = readFileSync(path.join(root, file), 'utf8')
  const needsScan =
    text.includes(NAVIGATION) ||
    (text.includes('locale') && text.includes('NextIntlClientProvider')) ||
    (FIXTURE.test(file) && text.includes('locale') && text.includes('Locale'))
  if (!needsScan) return []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const removable = LOCALE_DELETES.some((entry) => file === entry || file.startsWith(`${entry}/`))
  const navigation = navigationReferences(source)
  // A Vitest/Jest mock factory supplies the module, so it has no generated dependency.
  const mockOnly = navigation.length > 0 && navigation.every((kind) => kind === 'mock')
  const failures = []
  if (navigation.length > 0 && !mockOnly && !navigationFacts.has(file) && !removable) {
    failures.push(`${file}: imports "${NAVIGATION}"; add locale.navigation-* or declare it removable`)
  }
  if (!removable && !localeFacts.has(file)) {
    for (const literal of fixtureLiterals(source, file)) {
      failures.push(`${file}: hardcoded locale "${literal}"; use DEFAULT_LOCALE or register a locale-specific fixture`)
    }
  }
  return failures
}

export function collectLocaleProjectionGuardFailures(root = process.cwd()) {
  const navigationFacts = registeredPaths('locale.navigation-')
  const localeFacts = registeredPaths('locale.')
  return walk(root).flatMap((file) => failuresForFile(root, file, navigationFacts, localeFacts))
}

export function assertLocaleProjectionGuards(root = process.cwd()) {
  const failures = collectLocaleProjectionGuardFailures(root)
  if (failures.length) throw new Error(`locale-projection-guard:\n${failures.join('\n')}`)
}
