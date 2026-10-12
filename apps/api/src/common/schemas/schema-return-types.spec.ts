import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import ts from 'typescript'

describe('SchemaResponse return-type enforcement', () => {
  function diagnostics(returnType: string, result: string) {
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
      declare const schema: z.ZodObject<{ id: z.ZodString }>
      class Dto extends createSchemaDto(schema) {}
      class Controller {
        @SchemaResponse({ type: Dto })
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
})
