import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type ProbeReceipt } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'

import { emailAction, item } from './integrations-fixtures'
import { integrationsMessages } from './integrations-test-messages'
import { ProbeAction } from './ProbeAction'

vi.mock('@/shared/api/console-api', () => ({
  consoleApi: {
    prepareIntegrationProbe: vi.fn(),
    runIntegrationProbe: vi.fn(),
    getIntegrationProbeReceipt: vi.fn(),
    stepUp: vi.fn(),
  },
}))
vi.mock('@/shared/ui/console-detail/ConsoleTimestamp', () => ({
  ConsoleTimestamp: ({ value }: { value: string }) => <time>{value}</time>,
}))

/** The step-up dialog is mounted (closed) next to the action, so its copy must resolve too. */
const messages = {
  ...integrationsMessages,
  common: { cancel: 'Cancel', close: 'Close' },
  console: {
    ...integrationsMessages.console,
    stepUpTitle: 'Confirm your password',
    stepUpDescription: 'Enter your password to continue.',
    stepUpSubmit: 'Continue',
    loginPassword: 'Password',
  },
}

const ATTEMPT = 'A'.repeat(22)
const prepared = {
  attemptId: ATTEMPT,
  recipientHint: 'd***@example.com',
  expiresAt: '2026-10-22T12:30:00.000Z',
}
const receipt = (over: Partial<ProbeReceipt> = {}): ProbeReceipt => ({
  attemptId: ATTEMPT,
  state: 'settled',
  outcome: 'simulated',
  class: null,
  provider: 'mock',
  reservedAt: '2026-10-22T12:00:00.000Z',
  settledAt: '2026-10-22T12:00:01.000Z',
  ...over,
})
const refusal = (status: number, errorCode: string) =>
  new ApiRequestError(status, { statusCode: status, message: errorCode, errorCode } as never)

function view(over: Parameters<typeof item>[0] = {}, online = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
        <ProbeAction item={item(over)} online={online} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}
const click = (target: RegExp | string | HTMLElement) =>
  userEvent.click(
    target instanceof HTMLElement ? target : screen.getByRole('button', { name: target })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consoleApi.prepareIntegrationProbe).mockResolvedValue(prepared)
  vi.mocked(consoleApi.runIntegrationProbe).mockResolvedValue(receipt())
  vi.mocked(consoleApi.getIntegrationProbeReceipt).mockResolvedValue(receipt())
})

describe('test email flow', () => {
  it('prepares, confirms with the masked recipient, runs once and shows a reopenable result', async () => {
    view()
    await click('Send test email')
    expect(await screen.findByText('Send a test email?')).toBeInTheDocument()
    expect(screen.getByText(/d\*\*\*@example\.com/)).toBeInTheDocument()
    expect(consoleApi.runIntegrationProbe).not.toHaveBeenCalled()

    await click('Send test')
    expect(await screen.findByText(/Simulated\. The mock provider is in use/)).toBeInTheDocument()
    expect(consoleApi.runIntegrationProbe).toHaveBeenCalledExactlyOnceWith('email', ATTEMPT)

    await click('Close')
    await waitFor(() => expect(screen.queryByText('Test email result')).not.toBeInTheDocument())
  })

  it('never prepares or sends from a refresh: nothing happens until the button is pressed', () => {
    view()
    expect(consoleApi.prepareIntegrationProbe).not.toHaveBeenCalled()
    expect(consoleApi.runIntegrationProbe).not.toHaveBeenCalled()
  })

  it('cancelling the confirmation sends nothing', async () => {
    view()
    await click('Send test email')
    await screen.findByText('Send a test email?')
    await click('Cancel')
    await waitFor(() => expect(screen.queryByText('Send a test email?')).not.toBeInTheDocument())
    expect(consoleApi.runIntegrationProbe).not.toHaveBeenCalled()
  })

  it('reads the stored receipt after a lost response and never posts a second time', async () => {
    vi.mocked(consoleApi.runIntegrationProbe).mockRejectedValue(new ApiNetworkError('offline'))
    view()
    await click('Send test email')
    await click(await screen.findByRole('button', { name: 'Send test' }))
    expect(await screen.findByText(/Simulated\. The mock provider is in use/)).toBeInTheDocument()
    expect(consoleApi.runIntegrationProbe).toHaveBeenCalledTimes(1)
    expect(consoleApi.getIntegrationProbeReceipt).toHaveBeenCalledWith(
      'email',
      ATTEMPT,
      expect.anything()
    )
  })

  it('offers "Start again" after an expired confirmation and prepares a fresh attempt', async () => {
    vi.mocked(consoleApi.runIntegrationProbe).mockRejectedValue(
      refusal(410, 'INTEGRATION_ATTEMPT_EXPIRED')
    )
    view()
    await click('Send test email')
    await click(await screen.findByRole('button', { name: 'Send test' }))
    expect(
      await screen.findByText('The confirmation expired. Start the test again.')
    ).toBeInTheDocument()
    await click('Start again')
    await waitFor(() => expect(consoleApi.prepareIntegrationProbe).toHaveBeenCalledTimes(2))
  })

  it('shows a refusal without a restart button when only waiting helps', async () => {
    vi.mocked(consoleApi.runIntegrationProbe).mockRejectedValue(
      refusal(429, 'INTEGRATION_PROBE_COOLDOWN')
    )
    view()
    await click('Send test email')
    await click(await screen.findByRole('button', { name: 'Send test' }))
    expect(
      await screen.findByText('A test was started a moment ago. Wait before starting another.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start again' })).not.toBeInTheDocument()
  })

  it('explains an unknown outcome without saying the email was not sent', async () => {
    vi.mocked(consoleApi.runIntegrationProbe).mockResolvedValue(
      receipt({ outcome: 'unknown', class: 'rate_limit' })
    )
    view()
    await click('Send test email')
    await click(await screen.findByRole('button', { name: 'Send test' }))
    expect(
      await screen.findByText(/Outcome unknown\. The provider may or may not/)
    ).toBeInTheDocument()
    expect(
      screen.getByText('The provider reported a limit. Acceptance is not confirmed.')
    ).toBeInTheDocument()
  })
})

describe('availability and reopening', () => {
  it('disables the button and says why, with the remaining seconds for a cooldown', () => {
    view({
      action: {
        ...emailAction,
        available: false,
        unavailableReason: 'cooldown',
        cooldownRemainingSeconds: 31,
      },
    })
    expect(screen.getByRole('button', { name: 'Send test email' })).toBeDisabled()
    expect(screen.getByText(/A test was started a moment ago\. \(31 s\)/)).toBeInTheDocument()
  })

  it('reopens the operator’s own attempt read-only, without preparing or posting', async () => {
    view({ action: { ...emailAction, ownAttemptId: ATTEMPT } })
    await click(/Last test/)
    expect(await screen.findByText(/Simulated\. The mock provider is in use/)).toBeInTheDocument()
    expect(consoleApi.getIntegrationProbeReceipt).toHaveBeenCalledWith(
      'email',
      ATTEMPT,
      expect.anything()
    )
    expect(consoleApi.prepareIntegrationProbe).not.toHaveBeenCalled()
    expect(consoleApi.runIntegrationProbe).not.toHaveBeenCalled()
  })

  it('says a result is no longer stored when the receipt is gone', async () => {
    vi.mocked(consoleApi.getIntegrationProbeReceipt).mockRejectedValue(
      refusal(404, 'RESOURCE_NOT_FOUND')
    )
    view({ action: { ...emailAction, ownAttemptId: ATTEMPT } })
    await click(/Last test/)
    expect(await screen.findByText('This result is no longer stored.')).toBeInTheDocument()
  })
})

describe('a send that may have happened (C1)', () => {
  it('reads the same attempt when the answer says the result is not readable yet, and posts once', async () => {
    vi.mocked(consoleApi.runIntegrationProbe).mockResolvedValue(
      receipt({ outcome: 'in_progress', state: 'sending', settledAt: null })
    )
    view()
    await click('Send test email')
    await click(await screen.findByRole('button', { name: 'Send test' }))
    expect(await screen.findByText(/Simulated\. The mock provider is in use/)).toBeInTheDocument()
    expect(consoleApi.runIntegrationProbe).toHaveBeenCalledTimes(1)
    expect(consoleApi.getIntegrationProbeReceipt).toHaveBeenCalledWith(
      'email',
      ATTEMPT,
      expect.anything()
    )
  })

  it('says nothing was sent only for a refusal that happened before sending, in real words', async () => {
    vi.mocked(consoleApi.runIntegrationProbe).mockRejectedValue(
      refusal(503, 'INTEGRATION_PROBE_UNAVAILABLE')
    )
    view()
    await click('Send test email')
    await click(await screen.findByRole('button', { name: 'Send test' }))
    expect(
      await screen.findByText('The check could not start. Nothing was sent. Try again in a moment.')
    ).toBeInTheDocument()
    expect(consoleApi.getIntegrationProbeReceipt).not.toHaveBeenCalled()
  })

  it('shows the safe refusal class in plain words', async () => {
    vi.mocked(consoleApi.runIntegrationProbe).mockResolvedValue(
      receipt({ outcome: 'refused', class: 'auth', provider: 'resend' })
    )
    view()
    await click('Send test email')
    await click(await screen.findByRole('button', { name: 'Send test' }))
    expect(await screen.findByText('the provider did not accept the key')).toBeInTheDocument()
    expect(screen.getByText(/Check the provider key and the sender address/)).toBeInTheDocument()
  })
})

describe('offline (C7)', () => {
  it('disables the test and says why, because the result could not be read back', () => {
    view({}, false)
    expect(screen.getByRole('button', { name: 'Send test email' })).toBeDisabled()
    expect(screen.getByText('You are offline.')).toBeInTheDocument()
  })

  it('enables it again when the connection returns', () => {
    const { rerender } = view({}, false)
    expect(screen.getByRole('button', { name: 'Send test email' })).toBeDisabled()
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
          <ProbeAction item={item({})} online />
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
    expect(screen.getByRole('button', { name: 'Send test email' })).toBeEnabled()
  })
})
