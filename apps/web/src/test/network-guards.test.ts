import { existsSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createLintFixture } from '../../../../scripts/lib/lint-fixture.mjs'
import { RAW_FETCH_FILES } from '../../network-policy.mjs'

const fixture = createLintFixture()
afterAll(() => fixture.cleanup())
const rules = (code: string, file = 'src/network-probe.ts') =>
  fixture.lint(code, file).map((m: { ruleId: string }) => m.ruleId)

describe('network boundary through the paired wrapper', () => {
  it.each(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'])(
    'rejects global fetch in %s',
    (ext) => {
      expect(rules('void fetch("/api")', `src/probe.${ext}`)).toContain('no-restricted-globals')
    }
  )
  it.each([
    'const send = fetch; send("/")',
    'globalThis.fetch("/")',
    'window["fetch"]?.("/")',
    'const {fetch: send} = self; send("/")',
    'const g = globalThis; g.fetch.call(null, "/")',
    'const deps = {}; (deps.fetch ?? fetch)("/")',
  ])('rejects bypass: %s', (code) => {
    expect(rules(code).some((id: string) => /no-restricted-(globals|properties)/.test(id))).toBe(
      true
    )
  })
  it.each([
    'import send from "undici"; export {send}',
    'import {request as send} from "node:http"; export {send}',
    'export * from "axios/foo"',
    'export const send = import("node-fetch")',
    'export const send = require(`https`)',
  ])('rejects alternate transport: %s', (code) => {
    expect(rules(code).some((id: string) => /no-restricted-(imports|syntax)/.test(id))).toBe(true)
  })
  it('permits type-only HTTP imports and rejects CJS import-equals runtime loading', () => {
    const typeOnly = rules(
      'import type HTTP = require("node:http"); export type Server = HTTP.Server',
      'src/type-probe.cts'
    )
    expect(typeOnly).not.toContain('no-restricted-syntax')
    expect(typeOnly).not.toContain('no-restricted-imports')
    expect(
      rules('import HTTP = require("node:http"); export = HTTP', 'src/type-probe.cts')
    ).toContain('no-restricted-syntax')
  })
  it('keeps exact exceptions and rejects another fetch beside a helper', () => {
    expect(new Set(RAW_FETCH_FILES).size).toBe(RAW_FETCH_FILES.length)
    expect(
      RAW_FETCH_FILES.every((file: string) =>
        existsSync(path.join(import.meta.dirname, '../..', file))
      )
    ).toBe(true)
    expect(
      rules(
        'import {fetchBackendResponse} from "@/shared/api/backend-transport"; export const x = fetch("/"); export {fetchBackendResponse}'
      )
    ).toContain('no-restricted-globals')
  })
  it('permits a local fetch and test fixtures; reserves API_URL', () => {
    expect(rules('const fetch = () => 1; export const x = fetch()')).not.toContain(
      'no-restricted-globals'
    )
    expect(rules('export const x = fetch("/")', 'src/probe.test.ts')).not.toContain(
      'no-restricted-globals'
    )
    expect(rules('export const {API_URL: base} = process.env')).toContain(
      'no-restricted-properties'
    )
  })
})
