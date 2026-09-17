import ts from 'typescript'

import { findAllNodes } from './path-algebra-ast-query.mjs'
import { E2E_UI_PROFILES } from './project-locale-e2e-ui-surfaces.mjs'

const METHODS = new Set([
  'getByLabel',
  'getByPlaceholder',
  'getByRole',
  'getByText',
  'toContainText',
  'toHaveAccessibleName',
  'toHaveText',
])

function callMethod(call) {
  const expression = call.expression
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined
}

function owningUiCall(node) {
  let current = node.parent
  while (current && !ts.isStatement(current)) {
    if (ts.isCallExpression(current) && METHODS.has(callMethod(current))) return current
    current = current.parent
  }
  return undefined
}

function profileMap(namespaces, direction) {
  const entries = namespaces.flatMap((namespace) => E2E_UI_PROFILES[namespace] ?? [])
  return new Map(entries.map(([en, ru]) => (direction === 'en' ? [en, ru] : [ru, en])))
}

export function e2eUiExpectationInventory(model, namespaces, direction = 'en') {
  const replacements = profileMap(namespaces, direction)
  const references = findAllNodes(
    model,
    (node) =>
      (ts.isStringLiteral(node) || ts.isRegularExpressionLiteral(node)) &&
      replacements.has(node.getText()) &&
      owningUiCall(node)
  ).map((node) => ({ node, text: node.getText(), replacement: replacements.get(node.getText()) }))
  return { count: references.length, references }
}
