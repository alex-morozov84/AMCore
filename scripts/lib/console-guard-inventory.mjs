import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

// Static proof that every Operations Console entrypoint refuses before it starts any work.
// Pages, layouts and metadata functions call `requireConsoleEnabled()` as their first
// statement; Route Handlers return `withConsoleHostGuard(...)` as their first statement. Both
// helpers answer 404 when the Console is turned off. "First statement" means no promise,
// session read, Redis call or API fetch can exist before the refusal.

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const PAGE_FILES = new Set([
  'page.tsx',
  'layout.tsx',
  'template.tsx',
  'default.tsx',
  'not-found.tsx',
])
const METADATA_EXPORTS = new Set(['generateMetadata', 'generateViewport', 'generateStaticParams'])

export function consoleAlias(root) {
  const settings = JSON.parse(
    readFileSync(path.join(root, 'packages/shared/src/config/admin-console.json'), 'utf8')
  )
  return settings.alias
}

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

const isTest = (file) => /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(file)

/** Entrypoint files: pages and layouts of the Console folder (named by its alias) and its BFF routes. */
export function consoleEntrypoints(root) {
  const alias = consoleAlias(root)
  const pageRoot = path.join(root, 'apps/web/src/app/[locale]', alias)
  const routeRoot = path.join(root, 'apps/web/src/app/api/console')
  return {
    alias,
    pageRoot,
    pages: walk(pageRoot).filter((file) => PAGE_FILES.has(path.basename(file)) && !isTest(file)),
    routes: walk(routeRoot).filter((file) => path.basename(file) === 'route.ts' && !isTest(file)),
  }
}

function isCall(statement, name, { returned }) {
  let expression
  if (returned) {
    if (!ts.isReturnStatement(statement) || !statement.expression) return false
    expression = statement.expression
    if (ts.isAwaitExpression(expression)) expression = expression.expression
  } else {
    if (!ts.isExpressionStatement(statement)) return false
    expression = statement.expression
  }
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === name
  )
}

function asBody(body) {
  if (ts.isBlock(body)) return body
  return { statements: [ts.factory.createReturnStatement(body)] }
}

function localBodies(source) {
  const locals = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      locals.set(statement.name.text, statement.body)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          locals.set(declaration.name.text, asBody(init.body))
        }
      }
    }
  }
  return locals
}

// A refusal stub: `new Response(null, { status: 405, ... })` and nothing else. It starts no work, so
// it needs no guard; the proxy answers 404 for the whole Console path earlier when it is off.
function isMethodRefusal(body) {
  const only = body?.statements?.length === 1 ? body.statements[0] : undefined
  const expression = only && ts.isReturnStatement(only) ? only.expression : undefined
  return Boolean(
    expression &&
    ts.isNewExpression(expression) &&
    expression.expression.getText() === 'Response' &&
    /status:\s*405/.test(expression.getText())
  )
}

function exportedFunctions(source) {
  const found = []
  const locals = localBodies(source)
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : []
    const exported = modifiers.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
    const isDefault = modifiers.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword)
    if (ts.isFunctionDeclaration(statement) && exported) {
      found.push({
        name: isDefault ? 'default' : (statement.name?.text ?? 'default'),
        body: statement.body,
      })
    } else if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '?'
        const fn =
          init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
        // `export const POST = GET`: follow the alias to the local function it names.
        const aliased = init && ts.isIdentifier(init) ? locals.get(init.text) : undefined
        const body = fn ? asBody(fn.body) : aliased
        found.push({ name, body, notAFunction: !fn && !aliased })
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause) {
      for (const specifier of statement.exportClause.elements) {
        found.push({
          name: specifier.name.text,
          body: undefined,
          notAFunction: true,
          reexport: true,
        })
      }
    } else if (ts.isExportAssignment(statement)) {
      found.push({ name: 'default', body: undefined, notAFunction: true })
    }
  }
  return found
}

/** Returns a list of human-readable problems; an empty list means every entrypoint refuses first. */
export function inspectGuardFile(file, text, kind) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const problems = []
  const guard = kind === 'page' ? 'requireConsoleEnabled' : 'withConsoleHostGuard'
  for (const entry of exportedFunctions(source)) {
    const relevant =
      kind === 'page'
        ? entry.name === 'default' || METADATA_EXPORTS.has(entry.name)
        : HTTP_METHODS.has(entry.name)
    if (!relevant) continue
    const first = entry.body?.statements[0]
    if (kind === 'route' && isMethodRefusal(entry.body)) continue
    if (!first || !isCall(first, guard, { returned: kind !== 'page' })) {
      problems.push(`${file}: export "${entry.name}" must start with ${guard}(…)`)
    }
  }
  if (
    kind === 'route' &&
    !exportedFunctions(source).some((entry) => HTTP_METHODS.has(entry.name))
  ) {
    problems.push(`${file}: no HTTP method export found`)
  }
  return problems
}

export function inspectConsoleGuards(root) {
  const { pages, routes, pageRoot } = consoleEntrypoints(root)
  const problems = []
  if (!existsSync(pageRoot)) {
    problems.push(`Console page folder is missing: ${path.relative(root, pageRoot)}`)
  }
  for (const file of pages) {
    problems.push(
      ...inspectGuardFile(path.relative(root, file), readFileSync(file, 'utf8'), 'page')
    )
  }
  for (const file of routes) {
    problems.push(
      ...inspectGuardFile(path.relative(root, file), readFileSync(file, 'utf8'), 'route')
    )
  }
  return { pages: pages.length, routes: routes.length, problems }
}
