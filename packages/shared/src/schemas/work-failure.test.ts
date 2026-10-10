import { describe, expect, it } from 'vitest'

import {
  WORK_CATALOGUE_BYTES,
  WORK_DETAIL_BYTES,
  WORK_LIST_ROW_BYTES,
  workCatalogueSchema,
  workJobSchema,
  workListRowSchema,
  workPageSchema,
} from './background-work'
import { serializedJsonBytes } from './organization-members-budget'
import { workFailureDiagnosticSchema, workFailureReasonsSchema } from './work-failure'

const reason = { title: { en: 'Invalid image' }, nextStep: { en: 'Upload another file.' } }
const row = {
  identity: {
    id: 'image',
    incarnation: '019a1234-1234-7123-8123-123456789012',
    revision: 'a'.repeat(64),
  },
  state: 'failed',
  jobName: 'render',
  wireVersion: 1,
  sampledAt: '2026-10-10T12:00:00.000Z',
  source: 'broker',
  replay: 'idempotent',
  attemptsStarted: 1,
  manualGrant: 'none',
  projection: {},
  capabilities: [],
}
function paddedRow(bytes: number) {
  const value = { ...row, projection: {} as Record<string, string> }
  for (let i = 0; i < 64 && serializedJsonBytes(value) < bytes; i++) {
    const key = String(i)
    value.projection[key] = ''
    const length = Math.min(256, bytes - serializedJsonBytes(value))
    if (length < 0) throw new Error('Invalid boundary setup')
    value.projection[key] = 'x'.repeat(length)
  }
  expect(serializedJsonBytes(value)).toBe(bytes)
  return value
}
describe('failure declaration and public work byte contracts', () => {
  it('bounds encoded registration catalogues including Unicode and JSON escaping', () => {
    const catalogue = Array.from({ length: 64 }, (_, i) => ({
      id: `work-${i}`,
      kind: 'durable',
      status: 'available',
      definitionVersion: 1,
      sampledAt: '2026-10-10T12:00:00.000Z',
      capabilities: [],
      presentation: { name: { en: 'Work' }, fields: { reference: { en: 'x' } } },
    }))
    for (const entry of catalogue) {
      for (const locale of ['ru', 'de', 'fr', 'it', 'es', 'pt', 'nl']) {
        if (serializedJsonBytes(catalogue) >= WORK_CATALOGUE_BYTES) break
        Object.assign(entry.presentation.fields.reference, { [locale]: '😀"'.repeat(20) })
        if (serializedJsonBytes(catalogue) > WORK_CATALOGUE_BYTES) {
          Reflect.deleteProperty(entry.presentation.fields.reference, locale)
          break
        }
      }
    }
    while (serializedJsonBytes(catalogue) < WORK_CATALOGUE_BYTES) {
      const entry = catalogue.find((value) => value.presentation.fields.reference.en.length < 80)
      if (!entry) throw new Error('Boundary padding exhausted')
      entry.presentation.fields.reference.en += 'x'
    }
    expect(serializedJsonBytes(catalogue)).toBe(WORK_CATALOGUE_BYTES)
    expect(workCatalogueSchema.safeParse(catalogue).success).toBe(true)
    catalogue.find(
      (value) => value.presentation.fields.reference.en.length < 80
    )!.presentation.fields.reference.en += 'x'
    expect(workCatalogueSchema.safeParse(catalogue).success).toBe(false)
  })

  it('accepts exactly 8192 catalogue bytes and rejects one more', () => {
    const catalogue = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [
        `c${i}`,
        {
          title: { en: 'x'.repeat(80), ru: 'x'.repeat(80) },
          nextStep: { en: 'x'.repeat(160), ru: 'x' },
        },
      ])
    )
    for (const value of Object.values(catalogue)) {
      const remaining = 8192 - serializedJsonBytes(catalogue)
      value.nextStep.ru += 'x'.repeat(Math.min(159, remaining))
    }
    expect(serializedJsonBytes(catalogue)).toBe(8192)
    expect(workFailureReasonsSchema.safeParse(catalogue).success).toBe(true)
    Object.values(catalogue).find((value) => value.nextStep.ru.length < 160)!.nextStep.ru += 'x'
    expect(workFailureReasonsSchema.safeParse(catalogue).success).toBe(false)
  })
  it('bounds per-entry diagnostics including Unicode and JSON escaping', () => {
    expect(workFailureReasonsSchema.safeParse({ invalid: reason }).success).toBe(true)
    expect(
      workFailureReasonsSchema.safeParse({ invalid: { title: { ru: 'Ошибка' } } }).success
    ).toBe(false)
    const title = Object.fromEntries(
      ['en', 'ru', 'de', 'fr', 'it', 'es', 'pt', 'nl'].map((k) => [k, 'x'.repeat(80)])
    )
    const nextStep = Object.fromEntries(Object.keys(title).map((k) => [k, 'x'.repeat(160)]))
    expect(workFailureReasonsSchema.safeParse({ invalid: { title, nextStep } }).success).toBe(false)
    expect(
      workFailureDiagnosticSchema.safeParse({
        code: 'x',
        title: { en: '😀'.repeat(40) },
        nextStep: { en: '"'.repeat(160) },
      }).success
    ).toBe(true)
    expect(
      workFailureReasonsSchema.safeParse(
        Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['c' + i, reason]))
      ).success
    ).toBe(false)
    expect(workFailureReasonsSchema.safeParse({ 'secret://url': reason }).success).toBe(false)
    expect(
      workFailureReasonsSchema.safeParse({ invalid: { title: { ...title, ja: 'x' } } }).success
    ).toBe(false)
    const eighteen = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => ['c' + i, { title, nextStep: { en: 'x'.repeat(160) } }])
    )
    expect(workFailureReasonsSchema.safeParse(eighteen).success).toBe(false)
  })
  it('accepts exactly 1024 encoded diagnostic bytes and rejects one more', () => {
    const d = {
      code: 'x'.repeat(64),
      title: { en: 'x'.repeat(80), ru: 'x'.repeat(80), de: 'x'.repeat(80) },
      nextStep: { en: 'x'.repeat(160), ru: 'x'.repeat(160), de: 'x'.repeat(160), fr: '' },
    }
    d.nextStep.fr = 'x'.repeat(1024 - serializedJsonBytes(d))
    expect(workFailureDiagnosticSchema.safeParse(d).success).toBe(true)
    d.nextStep.fr += 'x'
    expect(workFailureDiagnosticSchema.safeParse(d).success).toBe(false)
  })
  it('separates 2KiB list rows from 16KiB detail and total 128KiB pages', () => {
    expect(workListRowSchema.safeParse(paddedRow(WORK_LIST_ROW_BYTES)).success).toBe(true)
    expect(workListRowSchema.safeParse(paddedRow(WORK_LIST_ROW_BYTES + 1)).success).toBe(false)
    expect(workJobSchema.safeParse(paddedRow(WORK_DETAIL_BYTES)).success).toBe(true)
    expect(workJobSchema.safeParse(paddedRow(WORK_DETAIL_BYTES + 1)).success).toBe(false)
    const page = {
      workId: 'image',
      sampledAt: row.sampledAt,
      rows: [paddedRow(WORK_LIST_ROW_BYTES + 1)],
      windowTruncated: false,
    }
    expect(workPageSchema.safeParse(page).success).toBe(false)
    page.rows = Array.from({ length: 50 }, () => paddedRow(WORK_LIST_ROW_BYTES))
    expect(workPageSchema.safeParse(page).success).toBe(true)
  })
})
