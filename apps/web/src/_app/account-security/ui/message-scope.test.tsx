import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider, useLocale, useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, it } from 'vitest'

import { AccountMfaMessages } from './message-scope'

function Content() {
  const t = useTranslations()
  return (
    <p>
      {useLocale()}:{t('accountMfa.title')}:{t('common.cancel')}
    </p>
  )
}

it.each(SUPPORTED_LOCALES)(
  'preserves the parent locale and shared messages during %s server rendering',
  (locale) => {
    const html = renderToString(
      <NextIntlClientProvider locale={locale} messages={{ common: { cancel: 'shared cancel' } }}>
        <AccountMfaMessages messages={{ title: 'account title' }}>
          <Content />
        </AccountMfaMessages>
      </NextIntlClientProvider>
    )
    expect(html.replaceAll('<!-- -->', '')).toContain(`${locale}:`)
    expect(html).toContain('account title')
    expect(html).toContain('shared cancel')
  }
)
