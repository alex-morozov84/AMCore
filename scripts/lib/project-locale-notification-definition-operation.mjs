import ts from 'typescript'

import { findAllNodes } from './path-algebra-ast-query.mjs'
import { CONFLICT_CODES, PathAlgebraConflictError } from './path-algebra-errors.mjs'
import { claim, localeParams } from './project-locale-ast-helpers.mjs'

const paramsSchema = (params) =>
  localeParams({ locale: params?.locale }) &&
  Object.keys(params).length === 2 &&
  Number.isInteger(params.englishBranches) &&
  params.englishBranches > 0

function isEnglishBranch(node) {
  if (!ts.isConditionalExpression(node)) return false
  const condition = node.condition
  return (
    ts.isBinaryExpression(condition) &&
    condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isIdentifier(condition.left) &&
    condition.left.text === 'locale' &&
    ts.isStringLiteral(condition.right) &&
    condition.right.text === 'en'
  )
}

function branchError(ctx, count, expected) {
  const code =
    count < expected ? CONFLICT_CODES.MISSING_SEMANTIC_NODE : CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE
  return new PathAlgebraConflictError(code, {
    paths: [ctx.path],
    dimensions: [],
    detail: `${ctx.operationKey}: expected ${expected} locale === 'en' branches, found ${count}`,
  })
}

function functionOwner(node) {
  let current = node.parent
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    )
      return current
    current = current.parent
  }
}

function inside(node, ancestor) {
  let current = node
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function orphanedLocaleBinding(model, branch) {
  const owner = functionOwner(branch)
  if (!owner) return undefined
  const parameters = owner.parameters.filter(
    (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === 'locale'
  )
  if (parameters.length !== 1) return undefined
  const [parameter] = parameters
  const outside = findAllNodes(
    model,
    (node) =>
      ts.isIdentifier(node) &&
      node.text === 'locale' &&
      node !== parameter.name &&
      !inside(node, branch.condition),
    owner
  )
  return outside.length === 0 ? parameter.name : undefined
}

function collapseEnglishBranches(model, { locale, englishBranches }, ctx) {
  const branches = findAllNodes(model, isEnglishBranch)
  if (branches.length !== englishBranches) {
    throw branchError(ctx, branches.length, englishBranches)
  }
  if (locale === 'en') return
  const bindings = new Set(branches.map((branch) => orphanedLocaleBinding(model, branch)))
  bindings.delete(undefined)
  for (const binding of bindings) model.replaceNode(binding, '_locale', ctx)
  for (const branch of branches) {
    const value = branch.whenFalse.getText()
    const replacement =
      ts.isObjectLiteralExpression(branch.whenFalse) && ts.isArrowFunction(branch.parent)
        ? `(${value})`
        : value
    model.replaceNode(branch, replacement, ctx)
  }
}

export function registerLocaleNotificationDefinitionOperation(registry) {
  registry.define('locale.notification-definition', {
    paramsSchema,
    deriveSemanticWrites: ({ locale }) => [
      claim(
        'ts:notification-definition:impossible-english-branches',
        locale === 'ru' ? 'absent' : 'preserved'
      ),
      claim(
        'ts:notification-definition:orphaned-locale-bindings',
        locale === 'ru' ? 'underscored' : 'preserved'
      ),
    ],
    adapter: collapseEnglishBranches,
  })
}
