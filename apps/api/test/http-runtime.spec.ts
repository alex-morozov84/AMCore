import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : []
  })
}

it('keeps Express adapters as development controls and emits one production bootstrap', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const name of [
    '@nestjs/platform-express',
    '@bull-board/express',
    'express',
    'cookie-parser',
  ]) {
    expect(manifest.dependencies[name]).toBeUndefined()
    expect(manifest.devDependencies[name]).toBeDefined()
  }
  expect(JSON.parse(readFileSync('nest-cli.json', 'utf8')).compilerOptions.deleteOutDir).toBe(true)
  expect(manifest.dependencies.helmet).toBeUndefined()
  expect(manifest.dependencies['@nestjs/platform-fastify']).toBeDefined()
  const main = readFileSync('src/main.ts', 'utf8')
  expect(main).toContain('createHttpAdapter(')
  expect(main).toContain('configureHttp(app,')
  expect(main).not.toContain('ExpressAdapter')
  const forbidden =
    /(?:from\s*|require\(\s*)['"](?:@nestjs\/platform-express|@bull-board\/express|cookie-parser|helmet)['"]/
  expect(sourceFiles('src').filter((path) => forbidden.test(readFileSync(path, 'utf8')))).toEqual(
    []
  )
})
