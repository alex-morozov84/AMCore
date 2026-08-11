import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

import '@testing-library/jest-dom/vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// jsdom doesn't implement matchMedia — needed by shared/lib/theme.ts and
// ThemeProvider (system-preference detection). Defaults to "no preference
// matched"; override per-test with window.matchMedia mockImplementationOnce
// where a test needs prefers-color-scheme: dark to be true.
// Guarded: this setup file also runs for `@vitest-environment node` suites
// (server-only modules, e.g. shared/api/bff), where `window` doesn't exist.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}
