import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { describeCall } from './project-locale-api-suite-helpers.mjs'

const TITLES = {
  en: 'renders English chrome for the en locale',
  ru: 'renders the dispatcher-supplied title/body and a CTA in Russian',
}

export function notificationSuite(model, { locale }, ctx) {
  const suite = describeCall(model, 'NotificationEmail Template (Integration)', ctx)
  const tests = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && Object.values(TITLES).includes(node.arguments[0]?.text),
    suite
  )
  if (tests.length !== 2) throw new Error(`${ctx.operationKey}: expected two locale chrome tests`)
  const selected = tests.find((node) => node.arguments[0].text === TITLES[locale])
  const other = tests.find((node) => node !== selected)
  model.replaceNode(selected.arguments[0], "'renders the selected locale chrome'", ctx)
  model.removeNode(other.parent, ctx)
  if (locale === 'en') {
    const title = findUniqueNode(
      model,
      (node) =>
        ts.isExpressionStatement(node) && node.getText().includes("toContain('New notification')"),
      { ...ctx, describe: 'English notification title assertion' },
      selected
    )
    model.replaceNode(
      title,
      `expect(html).toContain('<!DOCTYPE html')
    ${title.getText()}
    expect(html).toContain('You have a new notification.')
    expect(html).toContain('https://app.example')`,
      ctx
    )
  }
  const literals = findAllNodes(model, (node) => ts.isStringLiteral(node), suite)
  for (const node of literals) {
    if (model.isRemoved(node)) continue
    if (node.text === 'en') model.replaceNode(node, `'${locale}'`, ctx)
    if (node.text === 'Open AMCore' && locale === 'ru')
      model.replaceNode(node, "'Открыть AMCore'", ctx)
  }
}
