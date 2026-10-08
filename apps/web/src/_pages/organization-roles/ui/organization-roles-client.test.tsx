import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

import { OrganizationRolesClient } from './organization-roles-client'

vi.mock('@/entities/organization-context', () => ({
  useOrganizationContext: () => ({
    state: { status: 'pending' },
    data: undefined,
    controller: {},
    initialPending: true,
    busy: false,
    refresh: vi.fn(),
  }),
}))
vi.mock('@/widgets/organization-roles', () => ({ OrganizationRoles: () => null }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// The catalogue of the project's default locale, loaded by code so no locale file is hard-wired.
const messages = (await import(`../../../../messages/${DEFAULT_LOCALE}.json`)).default
const say = createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: 'organizationRoles' })

describe('OrganizationRolesClient without JavaScript', () => {
  it('tells the person why the page cannot be used', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
        <OrganizationRolesClient
          admission={{ binding: 'binding', actor: { id: 'actor' } } as never}
          organizationId="o"
          hrefs={{ overview: '/o', roles: '/o/roles' } as never}
          listHref="/organizations"
          query={{ page: 1, search: '' }}
        />
      </NextIntlClientProvider>
    )
    expect(html).toContain('<noscript>')
    expect(html).toContain(say('javascriptRequired'))
  })
})
