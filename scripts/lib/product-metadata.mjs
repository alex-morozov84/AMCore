import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMarkdownField } from './actions.mjs'
import { proposedLocales } from './product-settings-plan.mjs'

const starter = {
  en: 'Production-oriented application starter for secure, modular products.',
  ru: 'Стартовый шаблон для безопасных модульных приложений.',
}

export function productMetadata(root, answers) {
  const context = readFileSync(join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  const fresh = readMarkdownField(context, 'Mode')?.includes('upstream-starter')
  const relevant = [
    'productName',
    'nameEn',
    'nameRu',
    'descriptionEn',
    'descriptionRu',
    'productDescription',
    'locales',
    'defaultLocale',
  ].some((key) => answers[key] !== undefined)
  if (!relevant) return { answers, metadata: null }
  const current = Object.fromEntries(
    ['en', 'ru'].map((locale) => [
      locale,
      JSON.parse(readFileSync(join(root, `apps/web/messages/${locale}.json`), 'utf8')).meta,
    ])
  )
  const localeFile = join(root, 'packages/shared/src/config/locales.json')
  const previousDefault = JSON.parse(readFileSync(localeFile, 'utf8')).default
  const { default: defaultLocale, enabled } = proposedLocales(root, answers)
  const names = {
    en: answers.nameEn ?? (enabled.includes('en') ? answers.productName : undefined),
    ru: answers.nameRu ?? (enabled.includes('ru') ? answers.productName : undefined),
  }
  const descriptions = {
    en: answers.descriptionEn ?? answers.productDescription,
    ru: answers.descriptionRu,
  }
  const chosenName = names[defaultLocale] ?? (fresh ? undefined : current[defaultLocale].title)
  if (!chosenName) throw new Error('Enter a product name for the default site language')
  for (const locale of ['en', 'ru']) {
    if (fresh && !names[locale] && (enabled.includes(locale) || current[locale].title === 'AMCore'))
      names[locale] = chosenName
    if (fresh && !descriptions[locale] && current[locale].description === starter[locale])
      descriptions[locale] = names[locale] ?? current[locale].title
  }
  const syncName =
    fresh ||
    defaultLocale !== previousDefault ||
    (names[defaultLocale] !== undefined && chosenName !== current[defaultLocale].title)
  const syncDescription =
    fresh || defaultLocale !== previousDefault || descriptions[defaultLocale] !== undefined
  const description = syncDescription
    ? (descriptions[defaultLocale] ?? current[defaultLocale].description)
    : undefined
  return {
    answers: {
      ...answers,
      productName: syncName ? chosenName : undefined,
      productDescription: description,
    },
    metadata: { names, descriptions },
  }
}
