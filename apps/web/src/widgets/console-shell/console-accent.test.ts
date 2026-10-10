import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { contrastRatio, WCAG_AA_NORMAL_TEXT } from '@/shared/lib/contrast'

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/globals.css'),
  'utf8'
)

describe('Console selected-control contrast', () => {
  it.each([':root', '\\.dark'])('passes AA in %s', (selector) => {
    const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    const token = (name: string) => {
      const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1]
      if (!value) throw new Error(`Missing theme token ${name}`)
      return value
    }
    expect(
      contrastRatio(token('console-accent'), token('console-accent-foreground'))
    ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
  })
})
