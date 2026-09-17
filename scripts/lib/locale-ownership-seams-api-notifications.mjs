import { localeSeam } from './locale-ownership-seam.mjs'

const definitionSeams = [
  ['password-changed', 'account-password-changed.definition.ts', 3],
  ['profile-updated', 'account-profile-updated.definition.ts', 1],
  ['telegram-linked', 'account-telegram-linked.definition.ts', 1],
].map(([id, file, occurrences]) =>
  localeSeam(
    `locale.notification-definition-${id}`,
    `apps/api/src/core/notifications/definitions/${file}`,
    { text: "locale === 'en'" },
    ["locale === 'en'"],
    'locale.notification-definition',
    { occurrences }
  )
)

export const localeApiNotificationSeams = [
  localeSeam(
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
  localeSeam(
    'locale.notification-registry-typed-fixtures',
    'apps/api/src/core/notifications/notification-definition.registry.spec.ts',
    { identifiers: ['renderStored (version-aware, fail-closed)'] },
    ['renderStored (version-aware, fail-closed)'],
    'locale.api-fixture'
  ),
  localeSeam(
    'locale.invite-unknown-recipient-locale',
    'apps/api/src/core/organizations/invite.service.spec.ts',
    { identifiers: ['sends an org invite email with hasAccount=false for an unknown email'] },
    ['sends an org invite email with hasAccount=false for an unknown email'],
    'locale.api-link-fixture'
  ),
  localeSeam(
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
  ...definitionSeams,
]
