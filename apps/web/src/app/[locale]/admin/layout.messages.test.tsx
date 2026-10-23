import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

const catalogue = vi.hoisted(() => ({
  common: { close: 'Close' },
  console: { nav: { overview: 'Overview' } },
}))
vi.mock('server-only', () => ({}))
vi.mock('next/font/google', () => ({
  IBM_Plex_Sans: () => ({ variable: 'console-heading' }),
  JetBrains_Mono: () => ({ variable: 'console-mono' }),
}))
vi.mock('@/shared/lib/console-host-guard', () => ({ hasCanonicalConsoleHost: async () => true }))
vi.mock('next-intl/server', () => ({ getMessages: async () => catalogue }))

import { getClientMessages } from '@/i18n/client-messages'

import AdminLayout from './layout'

function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean)
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node
  return findElement((node.props as { children?: ReactNode }).children, type)
}

describe('Console messages', () => {
  it('stay out of the root provider and reach Console client components', async () => {
    expect(await getClientMessages()).toEqual({ common: catalogue.common })

    const provider = findElement(await AdminLayout({ children: null }), NextIntlClientProvider)
    expect((provider?.props as { messages?: unknown }).messages).toBe(catalogue)
  })
})
