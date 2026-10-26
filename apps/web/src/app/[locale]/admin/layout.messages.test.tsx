import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/font/google', () => ({
  IBM_Plex_Sans: () => ({ variable: 'console-heading' }),
  JetBrains_Mono: () => ({ variable: 'console-mono' }),
}))
vi.mock('@/shared/lib/console-host-guard', () => ({ hasCanonicalConsoleHost: async () => true }))

import { ClientMessages } from '@/i18n/client-message-boundary'

import AdminLayout from './layout'

function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean)
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node
  return findElement((node.props as { children?: ReactNode }).children, type)
}

describe('Console messages', () => {
  it('selects Console and its shared session consumers without the full catalogue', async () => {
    const provider = findElement(await AdminLayout({ children: null }), ClientMessages)
    expect((provider?.props as { namespaces?: unknown }).namespaces).toEqual([
      'console',
      'sessions',
    ])
  })
})
