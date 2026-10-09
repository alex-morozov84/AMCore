import { describe, expect, it } from 'vitest'

import { aiApprovalPreviewSchema } from './ai-approval-intent'
const preview = {
  title: 'Rename organization',
  summary: 'Change its visible name',
  target: { id: 'org-1', label: 'Team' },
  effects: ['Name becomes New team'],
}
describe('Owner preview wire boundary', () => {
  it('accepts bounded human text in either supported language', () => {
    expect(aiApprovalPreviewSchema.safeParse(preview).success).toBe(true)
    expect(
      aiApprovalPreviewSchema.safeParse({ ...preview, title: 'Переименовать организацию' }).success
    ).toBe(true)
  })
  it.each(['<script>', 'https://example.com/secret', 'line\ncontrol', 'delete\u007f'])(
    'refuses unsafe preview text %s',
    (title) => {
      expect(aiApprovalPreviewSchema.safeParse({ ...preview, title }).success).toBe(false)
    }
  )
  it('refuses unbounded or untyped significant action data', () => {
    for (const value of [
      { ...preview, effects: [] },
      { ...preview, effects: Array(11).fill('effect') },
      { ...preview, title: 'a'.repeat(1001) },
      { ...preview, args: { secret: 'value' } },
    ])
      expect(aiApprovalPreviewSchema.safeParse(value).success).toBe(false)
  })
})
