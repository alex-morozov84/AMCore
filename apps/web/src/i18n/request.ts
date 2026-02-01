import { getRequestConfig } from 'next-intl/server'

// For now, we only support Russian
// When adding more locales, this can be dynamic based on cookies/headers
export default getRequestConfig(async () => {
  const locale = 'ru'

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
