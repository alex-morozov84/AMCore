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

function collapseEnglishBranches(model, { locale, englishBranches }, ctx) {
  const branches = findAllNodes(model, isEnglishBranch)
  if (branches.length !== englishBranches) {
    throw branchError(ctx, branches.length, englishBranches)
  }
  if (locale === 'en') return
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
    ],
    adapter: collapseEnglishBranches,
  })
}
