import { readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { localeGuardSourceFiles } from './project-locale-source-files.mjs'
import { resolvePublicRepoRoot } from './working-tree-fixture.mjs'
const CONSOLE_TEST =
  /^apps\/web\/src\/(?:_pages\/console\/|(?:entities|features|widgets)\/console-[^/]+\/|shared\/lib\/console-public-href\.test\.)/
const TEST_FILE = /\.test\.[jt]sx?$/
const DEFAULT_CONSOLE_PATH = /^\/(?:en\/|ru\/)?admin(?:[/?#]|$)/
function literal(node) {
  if (!node) return undefined
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node : undefined
}
function fieldName(node) {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return undefined
}
function testCallback(node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined
  if (!['it', 'test'].includes(node.expression.text)) return undefined
  return node.arguments.find(
    (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
  )
}
function expectedLiteral(node, source) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined
  const matcher = node.expression.name.text
  if (matcher === 'toHaveAttribute' && literal(node.arguments[0])?.text === 'href') {
    return literal(node.arguments[1])
  }
  if (matcher === 'toHaveBeenCalledWith') {
    const expectation = node.expression.expression
    if (!ts.isCallExpression(expectation) || expectation.expression.getText(source) !== 'expect')
      return undefined
    const subject = expectation.arguments[0]?.getText(source) ?? ''
    if (!/^(?:(?:push|replace|navigate)Mock|router\.(?:push|replace))$/.test(subject))
      return undefined
    return literal(node.arguments[0])
  }
  if (!['toBe', 'toEqual'].includes(matcher)) return undefined
  if (!/getConsole\w*Href\s*\(/.test(node.expression.expression.getText(source))) return undefined
  return literal(node.arguments[0])
}
function helperFunctions(source) {
  return new Map(
    source.statements
      .filter((statement) => ts.isFunctionDeclaration(statement) && statement.name)
      .map((statement) => [statement.name.text, statement])
  )
}
function hasBaseHrefOverride(call) {
  return call.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some(
        (property) => ts.isPropertyAssignment(property) && fieldName(property.name) === 'baseHref'
      )
  )
}

function recordInput(node, state) {
  if (ts.isPropertyAssignment(node) && fieldName(node.name) === 'baseHref') {
    const value = literal(node.initializer)
    if (value) state.paths.add(value.text)
  }
  if (ts.isJsxAttribute(node) && node.name.text === 'baseHref') {
    const value = literal(node.initializer)
    if (value) state.paths.add(value.text)
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    if (ts.isPropertyAccessExpression(node.left)) {
      const owner = node.left.expression.getText()
      const field = node.left.name.text
      if (/config/i.test(owner) && ['mode', 'slug'].includes(field)) state.explicitTopology = true
    }
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'buildDiscoveryHref') {
      const value = literal(node.arguments[0])
      if (value) state.paths.add(value.text)
    }
  }
}

function inputPaths(callback, helpers, before) {
  const state = { paths: new Set(), explicitTopology: false }
  const visit = (node, depth = 0) => {
    if (depth === 0 && node.getStart() >= before) return
    recordInput(node, state)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const helper = helpers.get(node.expression.text)
      if (depth === 0 && helper && !hasBaseHrefOverride(node)) visit(helper.body, 1)
    }
    ts.forEachChild(node, (child) => visit(child, depth))
  }
  visit(callback.body)
  return state
}

function suppliedBase(expected, paths) {
  const base = expected.split(/[?#]/, 1)[0]
  return [...paths].some((input) => input.split(/[?#]/, 1)[0] === base)
}

export function scanConsoleTopologyAssertions(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const helpers = helperFunctions(source)
  const failures = []
  const inspect = (callback) => {
    const visit = (node) => {
      const value = expectedLiteral(node, source)
      if (value && DEFAULT_CONSOLE_PATH.test(value.text)) {
        const inputs = inputPaths(callback, helpers, value.getStart(source))
        if (!inputs.explicitTopology && !suppliedBase(value.text, inputs.paths)) {
          const line = source.getLineAndCharacterOfPosition(value.getStart(source)).line + 1
          failures.push(
            `${file}:${line}: hardcoded Console href ${JSON.stringify(value.text)}; use getConsole*Href() or an explicit test-local topology input`
          )
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(callback.body)
  }
  const visit = (node) => {
    const callback = testCallback(node)
    if (callback) inspect(callback)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return failures
}

export function collectConsoleTopologyAssertionFailures(root = resolvePublicRepoRoot()) {
  return localeGuardSourceFiles(root)
    .filter((file) => TEST_FILE.test(file) && CONSOLE_TEST.test(file))
    .flatMap((file) =>
      scanConsoleTopologyAssertions(file, readFileSync(path.join(root, file), 'utf8'))
    )
}

export function assertConsoleTopologyAssertions(root = resolvePublicRepoRoot()) {
  const failures = collectConsoleTopologyAssertionFailures(root)
  if (failures.length) throw new Error(`console-topology-assertions:\n${failures.join('\n')}`)
}
