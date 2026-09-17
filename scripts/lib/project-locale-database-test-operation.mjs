import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const paramsSchema = (params) =>
  localeParams({ locale: params?.locale }) &&
  Object.keys(params).length === 2 &&
  ['auth-e2e', 'oauth-e2e', 'negotiation-unit'].includes(params.variant)

function stringNode(model, target, value, ctx, expected = 1) {
  const matches = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && node.text === value,
    target
  )
  if (matches.length !== expected) {
    return findUniqueNode(model, () => false, {
      ...ctx,
      describe: `${expected} "${value}" strings`,
    })
  }
  return matches
}

function replaceStrings(model, target, replacements, ctx, write) {
  for (const [from, to, count = 1] of replacements) {
    for (const node of stringNode(model, target, from, ctx, count)) {
      if (write) model.replaceNode(node, `'${to}'`, ctx)
    }
  }
}

function authE2e(model, locale, ctx) {
  const explicit = testCall(model, 'prefers an explicit body locale over Accept-Language', ctx)
  replaceStrings(
    model,
    explicit,
    [
      ['en-US,en;q=0.9', 'ru-RU,ru;q=0.9'],
      ['ru', 'en', 2],
    ],
    ctx,
    locale === 'en'
  )
  const cases = [
    [
      'seeds locale from Accept-Language when no explicit locale is given',
      [
        ['en-US,en;q=0.9', 'ru-RU,ru;q=0.9'],
        ['enheader@example.com', 'ruheader@example.com'],
        ['en', 'ru'],
      ],
    ],
    ['falls back to the DB default for an unsupported Accept-Language', [['en', 'ru']]],
    ['updates name, locale, and timezone and persists them', [['en', 'ru', 3]]],
    ['updates only the supplied field and leaves the rest untouched', [['en', 'ru']]],
  ]
  for (const [title, replacements] of cases) {
    replaceStrings(model, testCall(model, title, ctx), replacements, ctx, locale === 'ru')
  }
}

function oauthE2e(model, locale, ctx) {
  const seeded = testCall(
    model,
    'seeds a new OAuth user locale from the authorize-time Accept-Language',
    ctx
  )
  replaceStrings(
    model,
    seeded,
    [
      ['en-US,en;q=0.9', 'ru-RU,ru;q=0.9'],
      ['en', 'ru'],
    ],
    ctx,
    locale === 'ru'
  )
  const fallback = testCall(
    model,
    'falls back to the DB default locale when authorize has no usable Accept-Language',
    ctx
  )
  replaceStrings(model, fallback, [['en', 'ru']], ctx, locale === 'ru')
}

function negotiationUnit(model, locale, ctx) {
  const target = testCall(
    model,
    'returns the negotiated supported locale for a matching header',
    ctx
  )
  replaceStrings(
    model,
    target,
    [
      ['en-US,en;q=0.9', 'ru-RU,ru;q=0.9'],
      ['en', 'ru', 2],
    ],
    ctx,
    locale === 'ru'
  )
}

function databaseTest(model, { locale, variant }, ctx) {
  if (variant === 'auth-e2e') authE2e(model, locale, ctx)
  else if (variant === 'oauth-e2e') oauthE2e(model, locale, ctx)
  else negotiationUnit(model, locale, ctx)
}

export function registerLocaleDatabaseTestOperation(registry) {
  registry.define('locale.database-default-test', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, variant }) => [
      claim(`ts:database-default-test:${variant}`, locale),
    ],
    adapter: databaseTest,
  })
}
