import { NextIntlClientProvider } from 'next-intl'
import {
  coerceSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportMailPreparation,
  type SupportMailStatus,
} from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { toast } from '@/shared/ui/toast'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

import { UserSupportMailCard } from './UserSupportMailCard'

vi.mock('@/shared/api/console-api', () => ({
  consoleApi: {
    getSupportMailStatus: vi.fn(),
    prepareSupportMail: vi.fn(),
    sendSupportMail: vi.fn(),
    getSupportMailReceipt: vi.fn(),
    stepUp: vi.fn(),
  },
}))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))

const status: SupportMailStatus = {
  serverNow: '2026-10-24T12:00:00.000Z',
  provider: 'mock',
  actions: ['email_verification', 'password_recovery'].map((kind) => ({
    kind,
    available: true,
    unavailableReason: null,
    retryAfterSeconds: 0,
    latest: null,
    resultExpired: false,
  })) as SupportMailStatus['actions'],
}
const preparation: SupportMailPreparation = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  kind: 'password_recovery',
  recipient: 'old-recipient@example.test',
  expiresAt: '2026-10-24T12:30:00.000Z',
  linkLifetimeSeconds: 900,
}
let client: QueryClient
function card(locale: 'en' | 'ru' = 'en', actorId = 'operator', userId = 'recipient') {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={coerceSupportedLocale(locale)}
        messages={locale === 'en' ? en : ru}
      >
        <UserSupportMailCard
          actorId={actorId}
          userId={userId}
          targetEmail="recipient@example.test"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(consoleApi.getSupportMailStatus).mockResolvedValue(status)
})

describe('support mail context and loading accessibility', () => {
  it('names the pending status with a supported ARIA role', () => {
    vi.mocked(consoleApi.getSupportMailStatus).mockReturnValue(new Promise(() => undefined))
    render(card())
    expect(screen.getByRole('status', { name: en.console.supportMail.loading })).toHaveAttribute(
      'aria-busy',
      'true'
    )
  })

  it.each(
    (
      [
        ['actor', 'en', 'other-operator', 'recipient'],
        ['target', 'en', 'operator', 'other-recipient'],
        ['locale', 'ru', 'operator', 'recipient'],
      ] as const
    ).filter(([change]) => change !== 'locale' || SUPPORTED_LOCALES.length > 1)
  )('discards a late preparation when %s changes', async (_change, locale, actor, target) => {
    let finish!: (value: SupportMailPreparation) => void
    vi.mocked(consoleApi.prepareSupportMail).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const view = render(card())
    const action = await screen.findByRole('button', {
      name: en.console.supportMail.password_recovery.button,
    })
    await waitFor(() => expect(action).toBeEnabled())
    fireEvent.click(action)
    await waitFor(() => expect(consoleApi.prepareSupportMail).toHaveBeenCalledTimes(1))
    view.rerender(card(locale, actor, target))
    await act(async () => finish(preparation))
    const copy = locale === 'en' ? en : ru
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: copy.console.supportMail.password_recovery.button })
      ).toBeEnabled()
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText(preparation.recipient)).not.toBeInTheDocument()
    expect(consoleApi.sendSupportMail).not.toHaveBeenCalled()
    expect(toast.add).not.toHaveBeenCalled()
    expect(consoleApi.getSupportMailStatus).toHaveBeenLastCalledWith(
      target,
      expect.any(AbortSignal)
    )
  })
})
