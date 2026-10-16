import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The account blocks keep the product-admin contract: reusable behavior lives below ready UI, a
 * custom UI can import only the public entity API, and no ready block knows the shell. Lint already
 * forbids upward FSD imports; this test names the contract so a rule change cannot drop it silently.
 */
const SRC = resolve(__dirname, '../../..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.(test|stories)\./.test(name) ? [path] : []
  })
}

function imports(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

describe('account blocks boundaries', () => {
  it('keeps the headless user entity free of features, widgets, pages, app composition and shell', () => {
    for (const file of sources(join(SRC, 'entities/user'))) {
      for (const specifier of imports(file)) {
        expect(specifier, file).not.toMatch(/^@\/(features|widgets|_pages|_app|app)\b/)
        expect(specifier, file).not.toMatch(/app-shell/i)
      }
    }
  })

  it('keeps the ready account blocks independent of the shell', () => {
    for (const dir of ['widgets/account-menu', 'features/avatar-edit']) {
      for (const file of sources(join(SRC, dir))) {
        for (const specifier of imports(file)) {
          expect(specifier, file).not.toMatch(/app-shell|AppShell/)
        }
      }
    }
  })

  it('keeps the shell from importing the account block, which the application places', () => {
    for (const file of sources(join(SRC, 'widgets/app-shell'))) {
      for (const specifier of imports(file)) {
        expect(specifier, file).not.toMatch(/account-menu|avatar-edit/)
      }
    }
  })

  it('lets a custom UI work with the public entity API alone', async () => {
    const entity = await import('@/entities/user')
    expect(entity.useCurrentUser).toBeTypeOf('function')
    expect(entity.useAvatarEditor).toBeTypeOf('function')
    expect(entity.AVATAR_LIMITS.maxBytes).toBe(2 * 1024 * 1024)
  })
})
