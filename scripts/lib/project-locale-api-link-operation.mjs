import { absent, claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  rewriteEmailDeliverer,
  rewriteInviteService,
  rewriteTelegramDeliverer,
} from './project-locale-api-link-fixtures.mjs'

const variants = ['email', 'invite', 'telegram']
const paramsSchema = (params) =>
  localeParams({ locale: params?.locale }) &&
  Object.keys(params).length === 2 &&
  variants.includes(params.variant)

function linkFixture(model, { locale, variant }, ctx) {
  if (variant === 'email') return rewriteEmailDeliverer(model, locale, ctx)
  if (variant === 'invite') return rewriteInviteService(model, locale, ctx)
  rewriteTelegramDeliverer(model, locale, ctx)
}

export function registerLocaleApiLinkOperation(registry) {
  registry.define('locale.api-link-fixture', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, variant }) => [
      claim(`ts:api-link-fixture:${variant}:locale`, locale),
      ...(variant === 'invite'
        ? [claim('ts:api-link-fixture:invite:unknown-recipient-locale', locale)]
        : []),
      absent(`ts:api-link-fixture:${variant}:locale-prefix`),
    ],
    adapter: linkFixture,
  })
}
