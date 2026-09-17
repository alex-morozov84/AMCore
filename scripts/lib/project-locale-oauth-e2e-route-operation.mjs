import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { testCall } from './project-locale-ast-helpers.mjs'

function statements(model, predicate, description, expected = 1, ctx) {
  const nodes = findAllNodes(model, (node) => ts.isExpressionStatement(node) && predicate(node))
  if (nodes.length === expected) return nodes
  return [
    findUniqueNode(model, () => false, {
      ...ctx,
      describe: `${expected} ${description}`,
    }),
  ]
}

function exactCallbackAssertion() {
  return `expect(res.headers.location).toBeDefined()
      const redirect = new URL(res.headers.location!)
      expect(redirect.origin).toBe(TRUSTED_ORIGIN)
      expect(redirect.pathname).toBe('/auth/callback')
      expect([...redirect.searchParams.keys()]).toEqual(['ticket'])
      expect(redirect.searchParams.get('ticket')).toBeTruthy()`
}

const locationAssertion = (node) => node.getText().startsWith('expect(res.headers.location)')

function selectedLocaleFixtures(model, locale, ctx) {
  const cases = [
    [
      'redirects to the callback under the locale the new user was seeded with',
      [
        ['ru-RU,ru;q=0.9', locale === 'en' ? 'en-US,en;q=0.9' : 'ru-RU,ru;q=0.9'],
        ['ru', locale],
      ],
    ],
    ['should keep link flow redirect unchanged', [['ru', locale]]],
  ]
  for (const [title, replacements] of cases) {
    const target = testCall(model, title, ctx)
    for (const [from, to] of replacements) {
      const node = findUniqueNode(
        model,
        (candidate) => ts.isStringLiteral(candidate) && candidate.text === from,
        { ...ctx, describe: `"${from}" fixture in "${title}"` },
        target
      )
      if (from !== to) model.replaceNode(node, `'${to}'`, ctx)
    }
  }
}

export function rewriteOAuthAssertions(model, locale, ctx) {
  selectedLocaleFixtures(model, locale, ctx)
  const claimed = []
  const callback = statements(
    model,
    (node) =>
      locationAssertion(node) &&
      node.getText().includes('(en|ru)') &&
      node.getText().includes('auth') &&
      node.getText().includes('callback'),
    'locale-prefixed callback assertions',
    2,
    ctx
  )
  const seeded = statements(
    model,
    (node) => locationAssertion(node) && node.getText().includes('/ru/auth/callback?ticket='),
    'seeded callback assertion',
    1,
    ctx
  )
  for (const node of [...callback, ...seeded]) {
    model.replaceNode(node, exactCallbackAssertion(), ctx)
    claimed.push(node)
  }
  for (const [needle, provider] of [
    ['linked-accounts?linked=google', 'google'],
    ['linked=apple', 'apple'],
  ]) {
    const [node] = statements(
      model,
      (item) => locationAssertion(item) && item.getText().includes(needle),
      `${provider} link assertion`,
      1,
      ctx
    )
    model.replaceNode(
      node,
      `expect(res.headers.location).toBe(\`${'${TRUSTED_ORIGIN}'}/settings/linked-accounts?linked=${provider}\`)`,
      ctx
    )
    claimed.push(node)
  }
  const [negative] = statements(
    model,
    (node) => locationAssertion(node) && node.getText().includes("not.toContain('/en/')"),
    'locale-prefix negative assertion',
    1,
    ctx
  )
  model.removeNode(negative, ctx)
  return [...claimed, negative]
}
