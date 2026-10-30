import { localeContent } from './project-locale-fact-helpers.mjs'

const definitions = [
  ['account-password-changed.definition.ts', 3],
  ['account-profile-updated.definition.ts', 1],
  ['account-telegram-linked.definition.ts', 1],
  ['account-mfa-backup-codes-changed.definition.ts', 1],
  ['account-mfa-backup-used.definition.ts', 1],
  ['account-mfa-factor-changed.definition.ts', 2],
]

export function buildLocaleNotificationFacts(locale) {
  const root = 'apps/api/src/core/notifications/definitions'
  return definitions.map(([file, englishBranches]) =>
    localeContent(`${root}/${file}`, 'locale.notification-definition', locale, {
      englishBranches,
    })
  )
}
