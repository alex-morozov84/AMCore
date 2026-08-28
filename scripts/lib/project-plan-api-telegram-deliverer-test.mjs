// init:project --mode=single: telegram-channel.deliverer.spec.ts. Found via
// the real `pnpm --filter api test` in init-project.test.mjs — this file
// reads `telegramGenericMessages.ru.title` directly, which no longer exists
// once project-plan-shared.mjs's buildSharedLocaleSteps trims that
// Record<SupportedLocale, ...> literal down to the kept locale's entry.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

function transform(locale) {
  return (content) => {
    let next = replaceExactBlock(content, "  locale: 'ru',\n", `  locale: '${locale}',\n`)
    next = replaceExactBlock(
      next,
      'telegramGenericMessages.ru.title',
      `telegramGenericMessages.${locale}.title`
    )
    return replaceExactBlock(
      next,
      "    // Locale-prefixed; 'https://app.example' alone would match a bare URL too.\n" +
        "    expect(client.sendMessage.mock.calls[0]![0].text).toContain('https://app.example/ru')\n",
      '    // Single-locale mode: no locale segment — anchor on the boundary so a\n' +
        '    // future regression back to a prefixed link would still be caught.\n' +
        '    expect(client.sendMessage.mock.calls[0]![0].text).toMatch(/https:\\/\\/app\\.example(?![\\w/])/)\n'
    )
  }
}

export function buildApiTelegramDelivererTestSteps(root, locale) {
  return [
    fileStep(
      path.join(
        root,
        'apps/api/src/core/notifications/channels/telegram/telegram-channel.deliverer.spec.ts'
      ),
      transform(locale),
      `telegram-channel.deliverer.spec.ts: use '${locale}' and read the trimmed message map by it`
    ),
  ]
}
