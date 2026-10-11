import { describe, expect, it } from 'vitest'

import { workListQuerySchema, workListWireQuerySchema } from './background-work'

describe('bounded work filters', () => {
  it('normalizes a bounded literal ID search and rejects arrays or oversized input', () => {
    expect(workListWireQuerySchema.parse({ search: '  job_1  ' }).search).toBe('job_1')
    expect(workListWireQuerySchema.safeParse({ search: ['job_1'] }).success).toBe(false)
    expect(workListWireQuerySchema.safeParse({ search: 'x'.repeat(129) }).success).toBe(false)
  })
  it('accepts one wire JSON string and the decoded internal contract', () => {
    const filters = { channel: 'telegram' }
    expect(workListWireQuerySchema.parse({ filters: JSON.stringify(filters) }).filters).toEqual(
      filters
    )
    expect(workListQuerySchema.parse({ filters }).filters).toEqual(filters)
    expect(workListWireQuerySchema.safeParse({ filters }).success).toBe(false)
  })

  it('rejects malformed, nested, oversized and repeated filter representations', () => {
    for (const filters of [
      '{',
      '[]',
      'null',
      '{"channel":{}}',
      ['{}'],
      JSON.stringify({ a: 'x', b: 'x', c: 'x', d: 'x', e: 'x' }),
      JSON.stringify({ channel: 'x'.repeat(65) }),
    ]) {
      expect(workListWireQuerySchema.safeParse({ filters }).success).toBe(false)
    }
  })

  it('bounds raw UTF-8 bytes including JSON whitespace', () => {
    const valid = '{"channel":"telegram"}'
    expect(workListWireQuerySchema.safeParse({ filters: valid.padEnd(1024) }).success).toBe(true)
    expect(workListWireQuerySchema.safeParse({ filters: valid.padEnd(1025) }).success).toBe(false)
    const escaped = JSON.stringify({ channel: 'я'.repeat(64) })
    expect(workListWireQuerySchema.safeParse({ filters: escaped }).success).toBe(true)
  })
})
