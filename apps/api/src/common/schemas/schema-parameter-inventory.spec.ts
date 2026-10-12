import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import ts from 'typescript'

function missingSchemas(text: string, filename: string) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  const missing: string[] = []
  let count = 0
  function visit(node: ts.Node) {
    if (ts.isParameter(node) && node.type?.getText(source).endsWith('Dto')) {
      for (const decorator of ts.getDecorators(node) ?? []) {
        const expression = decorator.expression
        if (!ts.isCallExpression(expression)) continue
        if (!['Body', 'Query', 'Param'].includes(expression.expression.getText(source))) continue
        count++
        const hasSchema = expression.arguments.some(
          (argument) =>
            ts.isObjectLiteralExpression(argument) &&
            argument.properties.some(
              (property) =>
                ts.isPropertyAssignment(property) && property.name.getText(source) === 'schema'
            )
        )
        if (!hasSchema) {
          missing.push(`${filename}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { missing, count }
}

describe('Native request schema declarations', () => {
  it('rejects a DTO parameter whose decorator omits the schema', () => {
    const result = missingSchemas('class C { handle(@Body() input: InputDto) {} }', 'fixture.ts')
    expect(result.count).toBe(1)
    expect(result.missing).toHaveLength(1)
  })

  it('keeps explicit schemas on every production DTO request parameter', () => {
    const root = resolve(__dirname, '../..')
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.controller.ts'))
      .map((name) => join(root, name))
    const results = files.map((file) =>
      missingSchemas(readFileSync(file, 'utf8'), relative(root, file))
    )
    expect(results.reduce((count, result) => count + result.count, 0)).toBeGreaterThan(0)
    expect(results.flatMap((result) => result.missing)).toEqual([])
  })
})
