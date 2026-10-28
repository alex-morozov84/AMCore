import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'

/** Keep selected-catalogue assertions and remove only the known MFA fixture route prefix. */
export function singleMfaFixture(model, { locale, variant }, ctx) {
  if (variant === 'mfa-story') {
    const attribute = findUniqueNode(
      model,
      (node) => ts.isJsxAttribute(node) && node.name.getText() === 'locale',
      { ...ctx, describe: 'MFA story locale provider' }
    )
    model.replaceNode(attribute.initializer, `"${locale}"`, ctx)
    return
  }
  const loop = findUniqueNode(model, (node) => ts.isForOfStatement(node), {
    ...ctx,
    describe: 'MFA browser locale loop',
  })
  const cases = findUniqueNode(
    model,
    (node) => ts.isArrayLiteralExpression(node),
    { ...ctx, describe: 'MFA locale cases' },
    loop.expression
  )
  if (cases.elements.length !== 2) throw new Error('MFA fixture locale cases drifted')
  const selected = cases.elements.find(
    (node) =>
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText() === 'locale' &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === locale
      )
  )
  if (!selected) throw new Error('MFA selected locale case missing')
  model.replaceNode(cases, `[${selected.getText()}]`, ctx)
  const routes = findAllNodes(
    model,
    (node) => ts.isTemplateExpression(node) && node.getText() === '`/${locale}/mfa`'
  )
  if (routes.length !== 2) throw new Error('MFA route fixture count drifted')
  for (const route of routes) model.replaceNode(route, "'/mfa'", ctx)
  const catalogue = findUniqueNode(
    model,
    (node) =>
      ts.isConditionalExpression(node) &&
      node.condition.getText() === "locale === 'en'" &&
      node.whenTrue.getText() === 'en' &&
      node.whenFalse.getText() === 'ru',
    { ...ctx, describe: 'MFA selected error catalogue' }
  )
  model.replaceNode(catalogue, locale, ctx)
}
