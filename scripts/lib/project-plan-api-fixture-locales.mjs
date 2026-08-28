// init:project --mode=single: spec files using 'ru' as an arbitrary sample
// locale value in a mock fixture (not testing locale-specific behavior), so
// each becomes the kept locale directly. Found via the real `pnpm --filter
// api test` in init-project.test.mjs.
import path from 'node:path'
import { fileStep, replaceAllExactText, replaceExactBlock } from './init-engine.mjs'

function simpleUserFixtureSteps(root, locale) {
  const targets = [
    [
      'apps/api/src/core/admin/admin.service.spec.ts',
      "    locale: 'ru',\n    timezone: 'Europe/Moscow',\n    systemRole: 'USER',\n",
    ],
    [
      'apps/api/src/core/auth/session.service.spec.ts',
      "    locale: 'ru',\n    timezone: 'Europe/Moscow',\n    createdAt: new Date('2024-01-01'),\n",
    ],
    [
      'apps/api/src/core/auth/user-cache.service.spec.ts',
      "    locale: 'ru',\n    timezone: 'Europe/Moscow',\n    createdAt: new Date('2026-01-01T00:00:00.000Z'),\n",
    ],
  ]
  return targets.map(([rel, before]) =>
    fileStep(
      path.join(root, rel),
      (content) => replaceExactBlock(content, before, before.replace("'ru'", `'${locale}'`)),
      `${rel}: use '${locale}' in the mock user fixture`
    )
  )
}

function emailChannelDelivererSteps(root, locale) {
  const rel = 'apps/api/src/core/notifications/channels/email-channel.deliverer.spec.ts'
  return [
    fileStep(
      path.join(root, rel),
      (content) => {
        let next = replaceExactBlock(content, "  locale: 'ru',\n", `  locale: '${locale}',\n`)
        next = replaceExactBlock(
          next,
          "title: 'Detailed x', body: 'Detailed body', locale: 'ru' }",
          `title: 'Detailed x', body: 'Detailed body', locale: '${locale}' }`
        )
        next = replaceAllExactText(
          next,
          "emailMessages.ru['notification.genericTitle']",
          `emailMessages.${locale}['notification.genericTitle']`
        )
        return replaceExactBlock(
          next,
          '      // Locale-prefixed: an email CTA cannot rely on a cookie or Accept-Language\n' +
            "      // the recipient's browser may not have.\n" +
            "      expect.objectContaining({ actionUrl: 'https://app.example/ru' }),\n",
          '      // Single-locale mode: no locale segment at all on the trusted app CTA link.\n' +
            "      expect.objectContaining({ actionUrl: 'https://app.example' }),\n"
        )
      },
      `${rel}: use '${locale}' in the delivery/render fixtures`
    ),
  ]
}

function notificationsServiceSteps(root, locale) {
  const rel = 'apps/api/src/core/notifications/notifications.service.spec.ts'
  return [
    fileStep(
      path.join(root, rel),
      (content) => replaceAllExactText(content, "locale: 'ru',", `locale: '${locale}',`),
      `${rel}: use '${locale}' in the three user-lookup fixtures`
    ),
  ]
}

function inviteServiceSteps(root, locale) {
  const rel = 'apps/api/src/core/organizations/invite.service.spec.ts'
  return [
    fileStep(
      path.join(root, rel),
      (content) => {
        const next = replaceAllExactText(content, "locale: 'ru',", `locale: '${locale}',`)
        return replaceExactBlock(
          next,
          'expect(data.acceptUrl).toMatch(/^https:\\/\\/app\\.example\\.com\\/ru\\/invite\\/accept\\?token=.+/)',
          'expect(data.acceptUrl).toMatch(/^https:\\/\\/app\\.example\\.com\\/invite\\/accept\\?token=.+/)'
        )
      },
      `${rel}: use '${locale}' in the target-user fixture and drop the now-unprefixed link's locale segment`
    ),
  ]
}

export function buildApiFixtureLocalesSteps(root, locale) {
  return [
    ...simpleUserFixtureSteps(root, locale),
    ...emailChannelDelivererSteps(root, locale),
    ...notificationsServiceSteps(root, locale),
    ...inviteServiceSteps(root, locale),
  ]
}
