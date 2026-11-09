import { useRef, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { type CatalogueLocale, LOCALE_CATALOGUES } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { createOrganizationAccessController } from '@/entities/organization-context'
import { Button } from '@/shared/ui/button'
import { waitForStorybookVisualStability } from '@/test/storybook/visual-stability'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

import { MemberRemoval } from './member-removal'

const catalogues = { en, ru }
const deletes = fn()

function RemovalPreview({ locale }: { locale: CatalogueLocale }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [open, setOpen] = useState(false)
  const [controller] = useState(() => {
    const access = createOrganizationAccessController('a'.repeat(64), 'story-organization')
    // Presentation fixture only; server authorization remains a real API guarantee.
    access.setAuthority(true)
    access.setRefresh(async () => 'ready')
    return access
  })
  const messages = catalogues[locale]
  // The global Storybook decorator supplies a fresh QueryClient for each story.
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <h2 ref={heading} tabIndex={-1}>
        {messages.organizationMembers.title}
      </h2>
      <Button onClick={() => setOpen(true)}>{messages.memberRemoval.title}</Button>
      <MemberRemoval
        controller={controller}
        target={{
          userId: 'story-actor',
          memberId: 'story-member',
          email: 'person@example.test',
          organizationName: 'Example',
        }}
        actorId="story-actor"
        heading={heading}
        open={open}
        onOpenChange={setOpen}
        onLock={() => undefined}
      />
    </NextIntlClientProvider>
  )
}

const meta = {
  title: 'Features/Member removal',
  component: RemovalPreview,
  beforeEach({ msw }) {
    deletes.mockClear()
    msw.use(
      http.delete(
        '/api/product-access/organizations/story-organization/members/story-actor',
        () => {
          deletes()
          return HttpResponse.json({ removed: true })
        }
      )
    )
  },
} satisfies Meta<typeof RemovalPreview>
export default meta
type Story = StoryObj<typeof meta>

function confirmation(locale: CatalogueLocale): Story {
  return {
    args: { locale },
    play: async ({ canvasElement }) => {
      const messages = catalogues[locale]
      const t = messages.memberRemoval
      const document = canvasElement.ownerDocument
      const canvas = within(canvasElement)
      const body = within(document.body)
      const previous = { width: innerWidth, height: innerHeight }
      const browser =
        import.meta.env.MODE === 'test' ? (await import('vitest/browser')).page : undefined
      try {
        if (browser) {
          await browser.viewport(320, 320)
          await expect({ width: innerWidth, height: innerHeight }).toEqual({
            width: 320,
            height: 320,
          })
        }
        await userEvent.click(canvas.getByRole('button', { name: t.title }))
        const dialog = await body.findByRole('alertdialog')
        await expect(dialog).toHaveTextContent(t.warning)
        await expect(dialog).toHaveTextContent(t.selfWarning)
        await expect(dialog).toHaveTextContent('person@example.test')
        const cancel = within(dialog).getByRole('button', { name: t.cancel })
        await waitFor(() => expect(cancel).toHaveFocus())
        await waitForStorybookVisualStability(dialog)
        if (browser) {
          const confirm = within(dialog).getByRole('button', { name: t.confirm })
          await waitFor(() => {
            const box = confirm.getBoundingClientRect()
            expect(box.top >= 0 && box.bottom <= innerHeight).toBe(true)
            expect(box.left >= 0 && box.right <= innerWidth).toBe(true)
            expect(document.documentElement.scrollWidth <= innerWidth).toBe(true)
          })
        }
        await userEvent.click(cancel)
        await waitFor(() => expect(body.queryByRole('alertdialog')).toBeNull())
        await waitFor(() => expect(canvas.getByRole('heading')).toHaveFocus())
        await expect(deletes).not.toHaveBeenCalled()
        // Leave the loaded dialog open for the global addon-a11y check.
        await userEvent.click(canvas.getByRole('button', { name: t.title }))
        await waitFor(() => expect(body.getByRole('alertdialog')).toBeVisible())
      } finally {
        if (browser) await browser.viewport(previous.width, previous.height)
      }
      await waitForStorybookVisualStability(document.body)
    },
  }
}

// Catalogue identity comes from shared configuration, independently of served locales.
const confirmations = Object.fromEntries(
  LOCALE_CATALOGUES.map((locale) => [locale, confirmation(locale)])
)
export const English: Story = confirmations.en!
export const Russian: Story = confirmations.ru!
