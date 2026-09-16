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

export const localeOwnershipSeams = [
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
    { identifiers: ['delegates to the service and returns the wrapped profile'] },
    ['delegates to the service and returns the wrapped profile'],
    'locale.auth-controller-typed-fixture'
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
