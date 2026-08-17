import { useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mswLoader } from 'msw-storybook-addon/csf3'

import { UIStoreProvider } from '@/shared/store'
import { handlers } from '@/test/msw/handlers'

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
  loaders: [mswLoader()],
  decorators: [
    // Toggles `.dark` on the story root — the same mechanism AMCore's real
    // dark-mode implementation uses (shared/lib/theme.ts's `applyTheme()`).
    // The real `ThemeProvider` is deliberately not wrapped globally (FINAL
    // PLAN decision 7): it reads `localStorage` via its own effect and would
    // fight this toolbar-driven class on every switch. No `shared/ui` story
    // calls `useTheme()` yet — add a targeted wrapper if and when one does.
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
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
  // Reuses the same handler definitions as the Vitest/msw-node integration
  // layer (ADR-069) — msw's http.* handlers are environment-agnostic
  // (setupServer vs. setupWorker only differ in entry point). Per-story
  // overrides use the same `beforeEach({ msw }) { msw.use(...) }` shape.
  beforeEach({ msw }) {
    msw.use(...handlers)
  },
}

export default preview
