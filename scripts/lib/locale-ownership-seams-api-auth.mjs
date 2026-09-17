import { localeSeam } from './locale-ownership-seam.mjs'

const emailTemplateSeams = [
  [
    'email-verification',
    'email-verification.integration.spec.ts',
    'EmailVerificationEmail(baseProps)',
    2,
  ],
  [
    'org-invite',
    'org-invite.integration.spec.ts',
    'OrgInviteEmail({ ...baseProps, hasAccount: true })',
    1,
  ],
  ['password-reset', 'password-reset.integration.spec.ts', 'PasswordResetEmail(baseProps)', 3],
].map(([id, file, identifier, occurrences]) =>
  localeSeam(
    `locale.${id}-test`,
    `apps/api/src/infrastructure/email/templates/${file}`,
    { identifiers: [identifier] },
    [identifier],
    'locale.email-template-test',
    { occurrences }
  )
)

const databaseTestSeams = [
  [
    'negotiation-unit-default',
    'apps/api/src/core/auth/locale-negotiation.spec.ts',
    ['returns the negotiated supported locale for a matching header'],
    1,
  ],
  [
    'auth-e2e-default',
    'apps/api/test/auth.e2e-spec.ts',
    [
      'seeds locale from Accept-Language when no explicit locale is given',
      'falls back to the DB default for an unsupported Accept-Language',
      'updates name, locale, and timezone and persists them',
      'updates only the supplied field and leaves the rest untouched',
    ],
    4,
  ],
  [
    'oauth-e2e-default',
    'apps/api/test/oauth.e2e-spec.ts',
    [
      'seeds a new OAuth user locale from the authorize-time Accept-Language',
      'falls back to the DB default locale when authorize has no usable Accept-Language',
    ],
    2,
  ],
].map(([id, path, identifiers, occurrences]) =>
  localeSeam(`locale.${id}`, path, { identifiers }, identifiers, 'locale.database-default-test', {
    occurrences,
  })
)

export const localeApiAuthSeams = [
  ...emailTemplateSeams,
  ...databaseTestSeams,
  localeSeam(
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
  localeSeam(
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
]
