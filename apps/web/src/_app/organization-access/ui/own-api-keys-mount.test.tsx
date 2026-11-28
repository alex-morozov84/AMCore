import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { ContextRequestError } from '@/shared/api/bff/context-errors'

import ru from '../../../../messages/ru.json'

import { OwnApiKeysMount } from './own-api-keys-mount'

const { readAdmission, renderKeys, refresh, redirect } = vi.hoisted(() => ({
  readAdmission: vi.fn(),
  renderKeys: vi.fn(() => null),
  refresh: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => () => ru.ownApiKeys.title }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))
vi.mock('@/entities/api-key/index.server', () => ({ readOwnApiKeyAdmission: readAdmission }))
vi.mock('@/_pages/own-api-keys', () => ({ OwnApiKeysPage: renderKeys }))
vi.mock('@/shared/api/bff/dal', () => ({ redirectToLogin: redirect }))

const mount = (requireAccess: () => Promise<void> = async () => {}) =>
  OwnApiKeysMount({ searchParams: Promise.resolve({}), requireAccess })

beforeEach(() => vi.clearAllMocks())

it.each([7, undefined])(
  'keeps keys behind admission when 429 carries %s seconds',
  async (delay) => {
    readAdmission.mockRejectedValueOnce(new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', delay))
    render(
      <NextIntlClientProvider locale="ru" messages={ru}>
        {await mount()}
      </NextIntlClientProvider>
    )

    expect(screen.getByRole('heading', { name: ru.ownApiKeys.title })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком много запросов.')
    if (delay === undefined) expect(screen.getByRole('alert').textContent).not.toMatch(/\d/)
    else expect(screen.getByRole('alert')).toHaveTextContent('Сервер просит подождать 7 секунд.')
    expect(renderKeys).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: ru.common.retry }))
    expect(refresh).toHaveBeenCalledOnce()
  }
)

it('preserves the existing redirect for a 401 admission response', async () => {
  readAdmission.mockRejectedValueOnce(new ContextRequestError(401, 'AUTH_CONTEXT_CHANGED'))
  await mount()
  expect(redirect).toHaveBeenCalledOnce()
})

it('rethrows an unexpected admission failure', async () => {
  const failure = new Error('unexpected')
  readAdmission.mockRejectedValueOnce(failure)
  await expect(mount()).rejects.toBe(failure)
})

it('shows the rate limit from administration access before checking key admission', async () => {
  const requireAccess = vi
    .fn()
    .mockRejectedValue(new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', 7))
  render(
    <NextIntlClientProvider locale="ru" messages={ru}>
      {await mount(requireAccess)}
    </NextIntlClientProvider>
  )
  expect(screen.getByRole('heading', { name: ru.ownApiKeys.title })).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('Сервер просит подождать 7 секунд.')
  expect(readAdmission).not.toHaveBeenCalled()
  expect(renderKeys).not.toHaveBeenCalled()
})
