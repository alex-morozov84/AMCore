import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clack } from './init-engine.mjs'
import { validateAnswers } from './brand-validate.mjs'
import { readMarkdownField } from './actions.mjs'
import { LOCALE_CATALOGUES, readLocaleSettings } from './settings-files.mjs'
import { administration } from './product-administration-questions.mjs'
import { repository } from './product-repository-questions.mjs'

function prompts(answers, language) {
  const tr = (en, ru) => (language === 'ru' ? ru : en)
  const descriptions = []
  async function answer(key, question, prompt) {
    const description = descriptions.splice(0).join('\n\n')
    if (answers[key] !== undefined) return answers[key]
    clack.note(description ? `${question}\n\n${description}` : question)
    const result = await prompt()
    if (clack.isCancel(result)) {
      clack.cancel(tr('Cancelled. No changes were written.', 'Отменено. Файлы не изменены.'))
      process.exit(1)
    }
    if (typeof result !== 'string' || result.trim() !== '') answers[key] = result
    return result
  }
  return {
    tr,
    note: (en, ru) => descriptions.push(tr(en, ru)),
    info: (en, ru) => clack.note(tr(en, ru)),
    text: (key, message, initialValue, validateValue) =>
      answer(key, message, async () => {
        const value = await clack.text({
          validate(input) {
            if (validateValue) return validateValue(input ?? '')
            if (key !== 'packageName' || !input?.trim()) return
            try {
              validateAnswers({ packageName: input.trim() }, language)
            } catch (error) {
              return error.message
            }
          },
          message: tr('Enter a value', 'Введите значение'),
          initialValue,
        })
        return !validateValue &&
          value === initialValue &&
          !['productName', 'nameEn', 'nameRu', 'workflowReference', 'packageName'].includes(key)
          ? ''
          : typeof value === 'string' && key === 'packageName'
            ? value.trim()
            : value
      }),
    select: (key, message, options, initialValue) =>
      answer(key, message, () =>
        clack.select({
          message: tr('Choose an option', 'Выберите вариант'),
          initialValue,
          showInstructions: language !== 'ru',
          options: options.map(([value, en, ru]) => ({ value, label: tr(en, ru) })),
        })
      ),
  }
}

async function languages(root, a, p) {
  const { tr, select, note, info } = p
  const current = readLocaleSettings(root)
  const options = [
    [LOCALE_CATALOGUES.join(','), 'Both languages', 'Английский и русский'],
    ...LOCALE_CATALOGUES.map((code) => [
      code,
      code === 'en' ? 'English only' : 'Russian only',
      code === 'en' ? 'Только английский' : 'Только русский',
    ]),
    ['help', 'Need another language?', 'Нужен другой язык?'],
  ]
  while (a.locales === undefined) {
    note(
      'With one language, URLs have no language prefix. Example: /login.\nWith two languages, URLs start with /en or /ru.\nExamples: /en/login and /ru/login.\nYou can change the site languages later.',
      'Если включить один язык, в адресах страниц не будет кода языка. Пример: /login.\nЕсли включить оба, адреса начнутся с /en или /ru.\nПримеры: /en/login и /ru/login.\nЯзыки сайта можно изменить позже.'
    )
    const choice = await select(
      'locales',
      tr('Which languages will the site serve?', 'На каких языках будет доступен сайт?'),
      options,
      current.enabled.join(',')
    )
    if (choice !== 'help') break
    delete a.locales
    info(
      'AMCore currently includes English and Russian translations for the site and emails.\nYou can add other languages later. The guide explains how to add the translations,\nenable a language and check that the translations are complete.\n\nHow to add a language\ndocs/frontend/i18n-and-errors.md#recipe-add-a-third-locale',
      'Сейчас сайт и письма AMCore переведены на английский и русский.\nДругие языки можно добавить после инициализации. В инструкции описано,\nкак подготовить переводы сайта и писем, включить язык и проверить полноту переводов.\n\nКак добавить язык\ndocs/frontend/i18n-and-errors.md#recipe-add-a-third-locale'
    )
  }
  const enabled = a.locales.split(',')
  if (enabled.length === 1) a.defaultLocale ??= enabled[0]
  else
    await select(
      'defaultLocale',
      tr(
        'Default site language (also used for install metadata)',
        'Язык сайта по умолчанию (также для имени и описания при установке)'
      ),
      [
        ['en', 'English', 'Английский'],
        ['ru', 'Russian', 'Русский'],
      ],
      current.default
    )
  return enabled
}

async function identity(root, a, p, enabled) {
  const { tr, select, text, note } = p
  const context = readFileSync(join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  const fresh = readMarkdownField(context, 'Mode')?.includes('upstream-starter')
  const meta = (locale) =>
    JSON.parse(readFileSync(join(root, `apps/web/messages/${locale}.json`), 'utf8')).meta
  const bilingual = enabled.length > 1
  const explicitTranslations = a.nameEn || a.nameRu || a.descriptionEn || a.descriptionRu
  const hasDifferentMetadata =
    meta('en').title !== meta('ru').title || meta('en').description !== meta('ru').description
  let separate = Boolean(bilingual && explicitTranslations)
  if (bilingual && !explicitTranslations) {
    note(
      'This applies to the name in <title> and the site description in <meta name="description">. Choose whether to enter each field once or enter it separately for each language.',
      'Это выбор для названия в <title> и описания сайта в <meta name="description">. Можно ввести каждое поле один раз или заполнить его отдельно для каждого языка.'
    )
    separate =
      (await select(
        'metadataPolicy',
        tr(
          'Use the same name and description for both languages?',
          'Использовать общие название и описание для обоих языков?'
        ),
        [
          ['shared', 'Enter the name and description once', 'Ввести название и описание один раз'],
          [
            'separate',
            'Enter both fields for each language',
            'Ввести название и описание для каждого языка',
          ],
        ],
        !fresh && hasDifferentMetadata ? 'separate' : 'shared'
      )) === 'separate'
  }
  note(
    'The product name appears in the browser tab (<title>), for example Sign in | Corner Shop. The default-language name is used when installing the site. You can change these names later.',
    'Название продукта появится во вкладке браузера (<title>), например «Вход | Лавка у дома». При установке сайта используется название на языке по умолчанию. Названия можно поменять позже.'
  )
  if (separate) {
    await text(
      'nameRu',
      tr('Product name in Russian', 'Название продукта на русском'),
      fresh ? undefined : meta('ru').title
    )
    await text(
      'nameEn',
      tr('Product name in English', 'Название продукта на английском'),
      fresh ? undefined : meta('en').title
    )
  } else
    await text(
      'productName',
      tr('Product name', 'Название продукта'),
      fresh ? undefined : meta(a.defaultLocale).title
    )
  const shared = bilingual && !separate
  const descriptionLocales = shared
    ? [a.defaultLocale]
    : [a.defaultLocale, ...enabled.filter((code) => code !== a.defaultLocale)]
  for (const locale of descriptionLocales) {
    note(
      'The description goes into HTML metadata. On first setup, skipping an unchanged starter description uses the product name. You can edit it later.',
      'Описание попадёт в <meta name="description">. Если пропустить исходное описание AMCore, мастер подставит название продукта. Описание можно изменить позже.'
    )
    if (locale === a.defaultLocale)
      note(
        'This description also goes into the install manifest and package.json.',
        'Это описание также попадёт в манифест приложения и package.json.'
      )
    const description = await text(
      locale === 'ru' ? 'descriptionRu' : 'descriptionEn',
      shared
        ? tr('Description for both languages', 'Описание для обоих языков')
        : locale === 'ru'
          ? tr('Russian description', 'Описание на русском')
          : tr('English description', 'Описание на английском'),
      fresh ? undefined : meta(locale).description
    )
    if (shared) {
      const common = description || (fresh ? a.productName : meta(locale).description)
      if (common) a.descriptionEn = a.descriptionRu = common
    }
  }
  const name = a[a.defaultLocale === 'ru' ? 'nameRu' : 'nameEn'] ?? a.productName
  const suggestion = name
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  note(
    'JavaScript tools use this name in package.json. Use a name such as my-app. Press Enter to accept the suggestion, or clear the field to leave it unchanged.',
    'Инструменты JavaScript используют это имя из package.json. Пример: my-app. Нажмите Enter, чтобы принять предложенное имя, или очистите поле, чтобы сохранить текущее.'
  )
  await text(
    'packageName',
    tr(
      'Technical name in package.json (optional)',
      'Техническое имя в package.json (можно пропустить)'
    ),
    fresh
      ? suggestion || undefined
      : JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
  )
}

async function appearance(root, a, p) {
  const { tr, select, note } = p
  const theme = readFileSync(join(root, 'apps/web/src/shared/lib/theme.ts'), 'utf8')
  const availability =
    readFileSync(join(root, 'apps/web/src/shared/lib/theme-availability.ts'), 'utf8').match(
      /THEME_AVAILABILITY: ThemeAvailability = '([^']+)'/
    )?.[1] ?? 'both'
  await select(
    'themeAvailability',
    tr(
      'Available themes (you can change this and rebuild later)',
      'Доступные темы (можно изменить и пересобрать сайт позже)'
    ),
    [
      ['both', 'Light and dark', 'Светлая и тёмная'],
      ['light', 'Light only', 'Только светлая'],
      ['dark', 'Dark only', 'Только тёмная'],
    ],
    availability
  )
  if (a.themeAvailability === 'both')
    await select(
      'themeMode',
      tr(
        'Theme before a visitor has a saved choice',
        'Тема, пока у посетителя нет сохранённого выбора'
      ),
      [
        ['system', 'Follow device', 'Как на устройстве'],
        ['light', 'Light', 'Светлая'],
        ['dark', 'Dark', 'Тёмная'],
      ],
      theme.match(/DEFAULT_THEME_SETTING: ThemeSetting = '([^']+)'/)?.[1] ?? 'system'
    )
  note(
    'A thin line shows that a page transition started. It is useful when the next page takes time to open. The line adds movement and may disappear while some content is still loading. Reduced motion removes the animation. Page-level loading indicators work either way. Change ROUTE_PROGRESS_ENABLED and rebuild to switch this later.',
    'Тонкая полоска вверху показывает, что переход начался. Она полезна, когда новая страница открывается с задержкой. Полоска добавляет движение и может исчезнуть, пока часть страницы ещё загружается. При уменьшении движения плавная анимация отключается. Индикаторы внутри страниц работают в обоих режимах. Позже можно изменить ROUTE_PROGRESS_ENABLED и пересобрать сайт.'
  )
  const progress = readFileSync(
    join(root, 'apps/web/src/shared/lib/route-progress/route-progress-flag.ts'),
    'utf8'
  )
  await select(
    'routeProgress',
    tr('Show the navigation progress bar?', 'Показывать полоску загрузки при переходах?'),
    [
      ['on', 'Show', 'Показывать'],
      ['off', 'Hide', 'Скрыть'],
    ],
    progress.includes('= true') ? 'on' : 'off'
  )
}

export async function productQuestions(root, answers, language) {
  const p = prompts(answers, language)
  if (language === 'ru') clack.intro('Настройка продукта. ↑/↓ — выбор, Enter — подтвердить.')
  const enabled = await languages(root, answers, p)
  await identity(root, answers, p, enabled)
  await appearance(root, answers, p)
  await administration(root, answers, p)
  await repository(root, answers, p)
}
