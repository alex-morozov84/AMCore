import ts from 'typescript'

import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'

const WORDS = {
  en: ['Welcome', 'Password Reset', 'Verify', 'invited'],
  ru: ['Добро пожаловать', 'Сброс пароля', 'Подтвердите', 'пригласил'],
}

const named = (model, predicate, describe, ctx, root) =>
  findUniqueNode(model, predicate, { ...ctx, describe }, root)

export function replaceRenderData(model, locale, ctx) {
  const type = named(
    model,
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'RenderCase',
    'RenderCase type',
    ctx
  )
  const expectation = named(
    model,
    (node) => ts.isPropertySignature(node) && node.name.getText() === 'expect',
    'RenderCase expectation property',
    ctx,
    type
  )
  model.replaceNode(expectation, 'expectedWord: string', ctx)
  const cases = named(
    model,
    (node) => isVariableStatementNamed(node, 'cases'),
    'cases declaration',
    ctx
  )
  const objects = cases.declarationList.declarations[0].initializer.elements
  if (objects.length !== WORDS[locale].length) {
    throw new Error(`${ctx.operationKey}: expected ${WORDS[locale].length} render cases`)
  }
  objects.forEach((object, index) => {
    const property = named(
      model,
      (node) => ts.isPropertyAssignment(node) && node.name.getText() === 'expect',
      `render case ${index + 1} expectation`,
      ctx,
      object
    )
    model.replaceNode(property, `expectedWord: '${WORDS[locale][index]}'`, ctx)
  })
  const ids = named(
    model,
    (node) => isVariableStatementNamed(node, 'localeIds'),
    'localeIds declaration',
    ctx
  )
  const catalogue = named(
    model,
    (node) => ts.isPropertyAccessExpression(node) && node.getText() === 'emailMessages.ru',
    'localeIds catalogue',
    ctx,
    ids
  )
  model.replaceNode(catalogue, `emailMessages.${locale}`, ctx)
}

export const renderWord = (locale, index = 0) => WORDS[locale][index]
