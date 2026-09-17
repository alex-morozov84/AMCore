import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName } from './project-locale-ast-helpers.mjs'

export function describeCall(model, title, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === title,
    { ...ctx, describe: `describe block "${title}"` }
  )
}
