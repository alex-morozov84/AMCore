import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { OwnApiKeyController } from '@/entities/api-key'

import { OwnApiKeyCreate } from './own-api-key-create'

vi.mock('@/i18n/navigation', () => ({ Link: 'a', useRouter: () => ({}) }))
vi.mock('client-only', () => ({}))
const messages = (await import(`../../../../messages/${DEFAULT_LOCALE}.json`)).default
const t = messages.ownApiKeys
it('removes concealed plaintext from DOM and preserves the confirmed result after temporary verification failure', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const input = {
    name: 'Export',
    expiresAt: '2026-11-18T09:33:25.660Z',
    organizationId: 'cmp00000000000000000000000',
    scopes: ['read:Organization'],
  }
  const client = {
    verify: vi.fn().mockResolvedValue({ verified: true as const }),
    create: vi.fn().mockResolvedValue({
      ...input,
      id: 'key-a',
      key: '<fake-secret>',
      expiresAt: null,
      createdAt: '2026-10-19T00:00:00.000Z',
    }),
    list: vi.fn(),
    revoke: vi.fn(),
  }
  const controller = new OwnApiKeyController({ binding: 'a'.repeat(64), actorId: 'actor' }, client)
  controller.setTarget('cmp00000000000000000000000')
  await controller.create(input)
  render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages} timeZone="UTC">
      <OwnApiKeyCreate
        controller={controller}
        organizationId="cmp00000000000000000000000"
        organizationName="Acme"
        canCreate={false}
        onInspect={async () => undefined}
      />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: t.openResult }))
  expect(screen.getByText(t.keyName.replace('{name}', 'Export'))).toBeVisible()
  expect(document.body.textContent).not.toContain(input.expiresAt)
  expect(screen.getByText(t.noExpiry)).toBeVisible()
  expect(screen.getByRole('button', { name: t.copy })).toContainElement(
    screen.getByRole('button', { name: t.copy }).querySelector('svg')
  )
  expect(screen.getByRole('textbox', { name: t.secret })).toHaveValue('<fake-secret>')
  act(() => controller.session.conceal())
  expect(screen.getByRole('textbox', { name: t.secret })).toHaveValue(
    '••••••••••••••••••••••••••••••••'
  )
  expect(screen.getByRole('button', { name: t.copy })).toBeDisabled()
  expect(screen.queryByRole('button', { name: t.verify })).not.toBeInTheDocument()
  expect(document.body.innerHTML.includes('&lt;fake-secret&gt;')).toBe(false)
  expect(document.body.innerHTML.includes('<fake-secret>')).toBe(false)
  expect(controller.getSnapshot().phase).toBe('confirmed')
  await act(async () => {
    await controller.session.check()
  })
  expect(screen.getByRole('textbox', { name: t.secret })).toHaveValue('<fake-secret>')
})
