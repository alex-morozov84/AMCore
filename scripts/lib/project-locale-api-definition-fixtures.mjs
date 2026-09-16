import ts from 'typescript'

import { findAllNodes } from './path-algebra-ast-query.mjs'
import { testCall } from './project-locale-ast-helpers.mjs'

const EMAIL_COPY = {
  en: ['Your password was changed', 'successfully changed'],
  ru: ['Ваш пароль был изменён', 'успешно изменён'],
}
const IN_APP = { en: 'Password changed', ru: 'Пароль изменён' }

export function rewritePasswordDefinition(model, locale, ctx) {
  const [title, body] = EMAIL_COPY[locale]
  model.replaceNode(
    testCall(model, 'renders detailed email copy from the projection in both locales', ctx),
    `it('renders detailed email copy from the projection', () => {
    const rendered = def.renderEmail!({ changedAt }, '${locale}')
    expect(rendered.title).toBe('${title}')
    expect(rendered.body).toContain('${body}')
  })`,
    ctx
  )
  model.replaceNode(
    testCall(model, 'renders a neutral in-app title/body without exposing the payload', ctx),
    `it('renders a neutral in-app title/body without exposing the payload', () => {
    expect(def.renderInApp({ changedAt }, '${locale}').title).toBe('${IN_APP[locale]}')
  })`,
    ctx
  )
}

export function rewriteRegistryDefinition(model, locale, ctx) {
  const target = testCall(model, 'renders localized in-app content', ctx)
  const assertions = findAllNodes(
    model,
    (node) => ts.isExpressionStatement(node) && node.getText().includes('def.renderInApp'),
    target
  )
  if (assertions.length !== 2) throw new Error('notification registry locale assertions drifted')
  const discarded = assertions.find((node) =>
    node.getText().includes(`'${locale === 'en' ? 'ru' : 'en'}'`)
  )
  if (!discarded) throw new Error('notification registry discarded locale assertion is missing')
  model.removeNode(discarded, ctx)
}
