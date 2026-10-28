import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import ts from 'typescript'

describe('SchemaResponse return-type enforcement', () => {
  function diagnostics(returnType: string, result: string, multiple = false) {
    const directory = mkdtempSync(join(tmpdir(), 'amcore-schema-types-'))
    const file = join(directory, 'fixture.ts')
    const dtoPath = resolve(__dirname, 'schema-dto').replaceAll('\\', '/')
    const responsePath = resolve(__dirname, 'schema-response').replaceAll('\\', '/')
    const zodPath = require
      .resolve('zod')
      .replace(/index\.cjs$/, 'index.d.cts')
      .replaceAll('\\', '/')
    writeFileSync(
      file,
      `
      import type { z } from ${JSON.stringify(zodPath)}
      import { createSchemaDto } from ${JSON.stringify(dtoPath)}
      import { SchemaResponse } from ${JSON.stringify(responsePath)}
      import { SchemaResponses } from ${JSON.stringify(resolve(__dirname, 'schema-responses').replaceAll('\\', '/'))}
      declare const schema: z.ZodObject<{ id: z.ZodString }>
      class Dto extends createSchemaDto(schema) {}
      class Controller {
        @${multiple ? 'SchemaResponses({ type: Dto, status: 200 }, { type: Dto, status: 202 })' : 'SchemaResponse({ type: Dto })'}
        handler(): ${returnType} { return ${result} }
      }
    `
    )
    try {
      const program = ts.createProgram([file], {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        esModuleInterop: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      })
      return ts.getPreEmitDiagnostics(program)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }

  it('accepts a matching synchronous return', () => {
    expect(
      diagnostics('{ id: string }', '{ id: "valid" }').map((error) => ({
        code: error.code,
        message: ts.flattenDiagnosticMessageText(error.messageText, '\n'),
      }))
    ).toEqual([])
  })

  it('rejects a mismatched return at the route decorator', () => {
    const errors = diagnostics('{ id: number }', '{ id: 42 }')
    expect(errors.map((error) => error.code)).toEqual([1241])
    expect(ts.flattenDiagnosticMessageText(errors[0]!.messageText, '\n')).toContain('id')
  })

  it('keeps return typing when several HTTP outcomes are declared', () => {
    expect(diagnostics('{ id: string }', '{ id: "valid" }', true)).toEqual([])
    expect(
      diagnostics('{ secret: string }', '{ secret: "invalid" }', true).map((error) => error.code)
    ).toEqual([1241])
  })
})

describe.each(['native', 'legacy'] as const)('%s response compiler contract', (compiler) => {
  const cases = [
    ['sync', '{ id: string }', '{ id: "valid" }', false],
    ['async', 'Promise<{ id: string }>', 'Promise.resolve({ id: "valid" })', false],
    ['array', 'Array<{ id: string }>', '[{ id: "valid" }]', false],
    ['union', '{ id: string } | { count: number }', '{ count: 1 }', false],
    ['multi', '{ id: string }', '{ id: "valid" }', false],
    ['invalid-sync', '{ id: number }', '{ id: 1 }', true],
    ['invalid-async', 'Promise<{ id: number }>', 'Promise.resolve({ id: 1 })', true],
    ['invalid-array', 'Array<{ id: number }>', '[{ id: 1 }]', true],
    ['invalid-union', '{ other: boolean }', '{ other: true }', true],
    ['invalid-multi', '{ other: boolean }', '{ other: true }', true],
  ] as const
  it.each(cases)('%s retains route return typing', (name, returnType, result, invalid) => {
    const directory = mkdtempSync(join(tmpdir(), 'native-schema-types-'))
    const file = join(directory, 'fixture.ts')
    const union = name.includes('union')
    const object = 'z.ZodObject<{ id: z.ZodString }>'
    const schemaType = union
      ? `z.ZodUnion<[${object}, z.ZodObject<{ count: z.ZodNumber }>]>`
      : object
    const zod = require.resolve('zod').replace(/index\.cjs$/, 'index.d.cts')
    writeFileSync(
      file,
      `import type {z} from ${JSON.stringify(zod)};
      import {createSchemaDto} from ${JSON.stringify(resolve(__dirname, 'schema-dto'))};
      import {SchemaResponse} from ${JSON.stringify(resolve(__dirname, 'schema-response'))};
      import {SchemaResponses} from ${JSON.stringify(resolve(__dirname, 'schema-responses'))};
      declare const schema: ${schemaType}; const Dto = createSchemaDto(schema);
      class Controller { @${name.includes('multi') ? 'SchemaResponses({type:Dto,status:200},{type:Dto,status:202})' : `SchemaResponse({type:${name.includes('array') ? '[Dto]' : 'Dto'}})`}
      handler(): ${returnType} {return ${result}} }`
    )
    const config = join(directory, 'tsconfig.json')
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          experimentalDecorators: true,
          esModuleInterop: true,
          target: 'ES2022',
          module: 'Preserve',
          moduleResolution: 'Bundler',
          types: ['node'],
          typeRoots: [resolve('node_modules/@types')],
        },
        files: [file],
      })
    )
    try {
      const check = spawnSync(
        process.execPath,
        [
          compiler === 'native'
            ? resolve(__dirname, '../../../../../scripts/typecheck-native.mjs')
            : require.resolve('typescript/bin/tsc'),
          '--noEmit',
          '-p',
          config,
          '--pretty',
          'false',
        ],
        { encoding: 'utf8', timeout: 15000 }
      )
      const output = check.stdout + check.stderr
      const codes = [...output.matchAll(/error TS(\d+)/g)].map((match) => Number(match[1]))
      expect(codes).toEqual(invalid ? [1241] : [])
      expect(check.status === 0).toBe(!invalid)
      expect([...output.matchAll(/fixture\.ts\(.*error TS1241/g)]).toHaveLength(invalid ? 1 : 0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
