import { useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import type { Preview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { UIStoreProvider } from '@/shared/store'

import defaultMessages from '../messages/en.json'

import '../src/app/globals.css'

// Fresh QueryClient per story render — not the app's `getQueryClient()`
// singleton, so one story's cache never bleeds into the next within the
// same Storybook browser session.
function QueryDecorator({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Every real component here lives under app/[locale] — required for
    // next/navigation hooks to resolve inside a story.
    nextjs: {
      appDirectory: true,
    },
    // CI-gating default (runs via addon-vitest's `test:storybook`). A
    // per-story `'todo'` override is for a real, tracked gap — not a way to
    // silence a violation. Complements, not replaces, the full-page
    // @axe-core/playwright scans in docs/frontend/testing.md.
    a11y: {
      test: 'error',
    },
  },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={defaultMessages}>
        <QueryDecorator>
          <UIStoreProvider>
            <Story />
          </UIStoreProvider>
        </QueryDecorator>
      </NextIntlClientProvider>
    ),
  ],
}

export default preview
