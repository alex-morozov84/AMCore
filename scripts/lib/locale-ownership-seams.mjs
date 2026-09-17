import {
  E2E_ROUTE_SURFACES,
  OAUTH_E2E_ROUTE_SURFACE,
} from './project-locale-e2e-route-surfaces.mjs'
import { E2E_UI_PROFILES, E2E_UI_SURFACES } from './project-locale-e2e-ui-surfaces.mjs'

const seam = (id, path, selector, detectors, operationKey, extra = {}) => ({
  id,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind: 'structural-operation',
  selector,
  detectors,
  operationKey,
  disposition: 'rewrite',
  ...extra,
})

const e2eRouteSeams = [...E2E_ROUTE_SURFACES, OAUTH_E2E_ROUTE_SURFACE].map(
  ([path, occurrences], index) =>
    seam(
      `locale.e2e-route-${index + 1}`,
      path,
      { identifiers: ['/en', '/ru', '/(en|ru)'] },
      ['locale-prefixed-route'],
      'locale.e2e-route-topology',
      { occurrences }
    )
)

const e2eUiSeams = E2E_UI_SURFACES.map(({ path, namespaces, expectedReferences }, index) =>
  seam(
    `locale.e2e-ui-${index + 1}`,
    path,
    {
      identifiers: [
        ...new Set(namespaces.flatMap((namespace) => E2E_UI_PROFILES[namespace].map(([en]) => en))),
      ],
    },
    ['english-localized-ui-expectation'],
    'locale.e2e-ui-expectations',
    { occurrences: expectedReferences }
  )
)

export const localeOwnershipSeams = [
  ...e2eRouteSeams,
  ...e2eUiSeams,
  seam(
    'locale.proxy-i18n-seam',
    'apps/web/src/proxy.ts',
    { identifiers: ['next-intl/middleware', './i18n/routing', 'handleI18nRouting'] },
    ['next-intl/middleware', './i18n/routing', 'handleI18nRouting'],
    'locale.proxy-i18n-seam',
    { occurrences: 4 }
  ),
  seam(
    'locale.prisma-user-default',
    'apps/api/prisma/user.prisma',
    { text: 'locale           String  @default("en")' },
    ['locale           String  @default("en")'],
    'locale.prisma-user-default'
  ),
  seam(
    'locale.sql-user-default',
    'apps/api/prisma/migrations/20260801103725_default_locale_en_timezone_utc/migration.sql',
    { text: 'ALTER COLUMN "locale" SET DEFAULT \'en\'' },
    ['ALTER COLUMN "locale" SET DEFAULT \'en\''],
    'locale.sql-user-default'
  ),
  seam(
    'locale.context',
    'PROJECT_CONTEXT.md',
    { identifiers: ['**i18n_mode:**', '**base_locale:**', '**supported_locales:**'] },
    ['locale-context'],
    'context-locale',
    { occurrences: 3 }
  ),
  seam(
    'locale.eslint-navigation',
    'apps/web/eslint.config.mjs',
    { identifiers: ['NAVIGATION_PATHS', 'project/import-guards-navigation-source'] },
    ['NAVIGATION_PATHS', 'project/import-guards-navigation-source'],
    'project-eslint-remove-navigation',
    { occurrences: 3, disposition: 'remove' }
  ),
  seam(
    'locale.request-catalogue',
    'apps/web/src/i18n/request.ts',
    { text: '../../messages/${locale}.json' },
    ['dynamic-catalogue-import'],
    'locale.request-config',
    { disposition: 'remove' }
  ),
  seam(
    'locale.email-verification-test',
    'apps/api/src/infrastructure/email/templates/email-verification.integration.spec.ts',
    { identifiers: ['EmailVerificationEmail(baseProps)'] },
    ['EmailVerificationEmail(baseProps)'],
    'locale.email-template-test',
    { occurrences: 2 }
  ),
  seam(
    'locale.org-invite-test',
    'apps/api/src/infrastructure/email/templates/org-invite.integration.spec.ts',
    { identifiers: ['OrgInviteEmail({ ...baseProps, hasAccount: true })'] },
    ['OrgInviteEmail({ ...baseProps, hasAccount: true })'],
    'locale.email-template-test'
  ),
  seam(
    'locale.password-reset-test',
    'apps/api/src/infrastructure/email/templates/password-reset.integration.spec.ts',
    { identifiers: ['PasswordResetEmail(baseProps)'] },
    ['PasswordResetEmail(baseProps)'],
    'locale.email-template-test',
    { occurrences: 3 }
  ),
  seam(
    'locale.auth-controller-typed-fixture',
    'apps/api/src/core/auth/auth.controller.spec.ts',
    {
      identifiers: [
        'delegates to the service and returns the wrapped profile',
        'passes the negotiated Accept-Language locale to the service',
      ],
    },
    [
      'delegates to the service and returns the wrapped profile',
      'passes the negotiated Accept-Language locale to the service',
    ],
    'locale.auth-controller-typed-fixture',
    { occurrences: 2 }
  ),
  seam(
    'locale.negotiation-unit-default',
    'apps/api/src/core/auth/locale-negotiation.spec.ts',
    { identifiers: ['returns the negotiated supported locale for a matching header'] },
    ['returns the negotiated supported locale for a matching header'],
    'locale.database-default-test'
  ),
  seam(
    'locale.auth-e2e-default',
    'apps/api/test/auth.e2e-spec.ts',
    {
      identifiers: [
        'seeds locale from Accept-Language when no explicit locale is given',
        'falls back to the DB default for an unsupported Accept-Language',
        'updates name, locale, and timezone and persists them',
        'updates only the supplied field and leaves the rest untouched',
      ],
    },
    [
      'seeds locale from Accept-Language when no explicit locale is given',
      'falls back to the DB default for an unsupported Accept-Language',
      'updates name, locale, and timezone and persists them',
      'updates only the supplied field and leaves the rest untouched',
    ],
    'locale.database-default-test',
    { occurrences: 4 }
  ),
  seam(
    'locale.oauth-e2e-default',
    'apps/api/test/oauth.e2e-spec.ts',
    {
      identifiers: [
        'seeds a new OAuth user locale from the authorize-time Accept-Language',
        'falls back to the DB default locale when authorize has no usable Accept-Language',
      ],
    },
    [
      'seeds a new OAuth user locale from the authorize-time Accept-Language',
      'falls back to the DB default locale when authorize has no usable Accept-Language',
    ],
    'locale.database-default-test',
    { occurrences: 2 }
  ),
  seam(
    'locale.auth-service-typed-fixtures',
    'apps/api/src/core/auth/auth.service.spec.ts',
    {
      identifiers: [
        'uses the explicit body locale over the negotiated header',
        'falls back to the negotiated Accept-Language locale when the body omits it',
      ],
    },
    [
      'uses the explicit body locale over the negotiated header',
      'falls back to the negotiated Accept-Language locale when the body omits it',
    ],
    'locale.auth-service-test',
    { occurrences: 2 }
  ),
  seam(
    'locale.telegram-content-typed-fixture',
    'apps/api/src/core/notifications/channels/telegram/telegram-content.spec.ts',
    {
      identifiers: [
        'renders detailed content only from the allowlisted projection (no raw payload leak)',
      ],
    },
    ['renders detailed content only from the allowlisted projection (no raw payload leak)'],
    'locale.telegram-content-test'
  ),
  seam(
    'locale.notification-registry-typed-fixtures',
    'apps/api/src/core/notifications/notification-definition.registry.spec.ts',
    { identifiers: ['renderStored (version-aware, fail-closed)'] },
    ['renderStored (version-aware, fail-closed)'],
    'locale.api-fixture'
  ),
  seam(
    'locale.invite-unknown-recipient-locale',
    'apps/api/src/core/organizations/invite.service.spec.ts',
    { identifiers: ['sends an org invite email with hasAccount=false for an unknown email'] },
    ['sends an org invite email with hasAccount=false for an unknown email'],
    'locale.api-link-fixture'
  ),
  seam(
    'locale.notification-feed-recipient',
    'apps/api/src/core/notifications/notification-feed.service.spec.ts',
    {
      identifiers: [
        "prisma.user.findUnique.mockResolvedValue({ locale: 'en' } as never)",
        'renders items in the recipient locale and reports no more when within limit',
      ],
    },
    [
      "prisma.user.findUnique.mockResolvedValue({ locale: 'en' } as never)",
      'renders items in the recipient locale and reports no more when within limit',
    ],
    'locale.notification-feed-test',
    { occurrences: 2 }
  ),
  seam(
    'locale.supported-schema-test',
    'packages/shared/src/schemas/auth.test.ts',
    { identifiers: ['accepts supported locales and rejects others'] },
    ['accepts supported locales and rejects others'],
    'locale.supported-schema-test'
  ),
  ...[
    ['password-changed', 'account-password-changed.definition.ts', 3],
    ['profile-updated', 'account-profile-updated.definition.ts', 1],
    ['telegram-linked', 'account-telegram-linked.definition.ts', 1],
  ].map(([id, file, occurrences]) =>
    seam(
      `locale.notification-definition-${id}`,
      `apps/api/src/core/notifications/definitions/${file}`,
      { text: "locale === 'en'" },
      ["locale === 'en'"],
      'locale.notification-definition',
      { occurrences }
    )
  ),
]
