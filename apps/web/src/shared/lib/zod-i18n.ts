import { z } from 'zod'

/**
 * Configure Zod to use Russian locale
 * Zod v4 has built-in internationalization support
 *
 * This should be called once at app initialization
 *
 * @see https://github.com/colinhacks/zod/issues/5106
 */
export function configureZodLocale() {
  // Configure Zod with Russian locale (Zod v4 native i18n)
  z.config(z.locales.ru())
}
