import { createTranslator } from 'next-intl'
import {
  ADMIN_CONSOLE_SETTINGS,
  type CatalogueLocale,
  DEFAULT_LOCALE,
  localePathPrefix,
} from '@amcore/shared'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'

/** Native journeys use the build's language; explicit multilingual journeys choose their own. */
export const messagesForLocale = (locale: CatalogueLocale) => ({ en, ru })[locale]
export const messages = messagesForLocale(DEFAULT_LOCALE)
export const translate = createTranslator({ locale: DEFAULT_LOCALE, messages })

export function sortColumnPattern(column: string) {
  const label = translate('console.sortColumnAction', { column, direction: '' })
  return new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

export function productPath(path = '/', locale: CatalogueLocale = DEFAULT_LOCALE) {
  return `${localePathPrefix(locale)}${path}`
}

export function consolePath(path = '', locale: CatalogueLocale = DEFAULT_LOCALE) {
  return `${localePathPrefix(locale)}/${ADMIN_CONSOLE_SETTINGS.alias}${path}`
}

export function isProductHome(url: URL, locale: CatalogueLocale = DEFAULT_LOCALE) {
  return url.pathname.replace(/\/$/, '') === localePathPrefix(locale)
}
