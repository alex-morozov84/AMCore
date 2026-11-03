import { afterEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.fn()
const permanentRedirect = vi.fn()

vi.mock('next-intl/navigation', () => ({
  createNavigation: () => ({
    Link: 'link',
    redirect,
    permanentRedirect,
    usePathname: () => '/',
    useRouter: () => ({}),
    getPathname: () => '/',
  }),
}))
vi.mock('next-intl/routing', () => ({ defineRouting: (config: object) => config }))
vi.mock('./routing', () => ({ routing: { locales: ['ru'], defaultLocale: 'ru' } }))

async function navigationFor(locales: string[]) {
  vi.resetModules()
  vi.doMock('@amcore/shared', () => ({ SERVED_LOCALES: locales }))
  return import('./navigation')
}

afterEach(() => {
  redirect.mockClear()
  permanentRedirect.mockClear()
  vi.doUnmock('@amcore/shared')
})

describe('locale option with one served locale', () => {
  it('is dropped, so no prefix is forced and no redirect hop is needed', async () => {
    const nav = await navigationFor(['ru'])
    expect(nav.withoutLocaleWhenSingle({ href: '/', locale: 'ru' })).toEqual({
      href: '/',
      locale: undefined,
    })
    nav.redirect({ href: '/login', locale: 'ru' })
    expect(redirect).toHaveBeenCalledWith({ href: '/login', locale: undefined }, undefined)
    nav.permanentRedirect({ href: '/x', locale: 'ru' })
    expect(permanentRedirect).toHaveBeenCalledWith({ href: '/x', locale: undefined }, undefined)
  })

  it('leaves options without a locale alone', async () => {
    const nav = await navigationFor(['ru'])
    const options: { locale?: unknown; scroll: boolean } = { scroll: false }
    expect(nav.withoutLocaleWhenSingle(options)).toBe(options)
    expect(nav.withoutLocaleWhenSingle(undefined)).toBeUndefined()
  })
})

describe('locale option with several served locales', () => {
  it('is kept, because naming a locale there means switching language', async () => {
    const nav = await navigationFor(['en', 'ru'])
    nav.redirect({ href: '/login', locale: 'ru' })
    expect(redirect).toHaveBeenCalledWith({ href: '/login', locale: 'ru' }, undefined)
    const options = { locale: 'ru' }
    expect(nav.withoutLocaleWhenSingle(options)).toBe(options)
  })
})
