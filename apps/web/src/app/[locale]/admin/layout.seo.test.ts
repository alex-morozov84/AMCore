import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('next/font/google', () => ({
  IBM_Plex_Sans: () => ({ variable: 'console-heading' }),
  JetBrains_Mono: () => ({ variable: 'console-mono' }),
}))
vi.mock('@/shared/lib/console-host-guard', () => ({ hasCanonicalConsoleHost: async () => true }))

import { noindexMetadata } from '@/shared/lib/seo/page-metadata'

import * as layout from './layout'

describe('Console layout and search engines', () => {
  it('stays closed to search engines on its own, whatever the root default is', () => {
    expect(layout.metadata).toBe(noindexMetadata)
    expect(layout.metadata).toEqual({ robots: { index: false, follow: false } })
  })
})
