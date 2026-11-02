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

// The guards live in one module. A file that declares its own function of the same name, or
// imports it from elsewhere, would pass a name-only check without refusing anything.
const GUARD_MODULE = '@/shared/lib/console-host-guard'

function isFunctionNode(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

// Page form: `requireConsoleEnabled()` with no argument. Route form: `withConsoleHostGuard(request,
// <function>)`: the request is a plain identifier and the work is a callback that runs only after
// the guard, so no argument can start anything before the refusal.
function hasGuardShape(call, returned) {
  if (!returned) return call.arguments.length === 0
  const [request, work] = call.arguments
  return (
    call.arguments.length === 2 && ts.isIdentifier(request) && Boolean(work && isFunctionNode(work))
  )
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
    expression.expression.text === name &&
    hasGuardShape(expression, returned)
  )
}

function importsGuard(source, name) {
  return source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === GUARD_MODULE &&
      !statement.importClause?.isTypeOnly &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) =>
          !element.isTypeOnly &&
          element.name.text === name &&
          (element.propertyName === undefined || element.propertyName.text === name)
      )
  )
}

function declaresLocally(source, name) {
  return source.statements.some((statement) => {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      return statement.name?.text === name
    if (!ts.isVariableStatement(statement)) return false
    return statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name
    )
  })
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

const isLiteral = (node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isNumericLiteral(node) ||
  node.kind === ts.SyntaxKind.TrueKeyword ||
  node.kind === ts.SyntaxKind.FalseKeyword ||
  node.kind === ts.SyntaxKind.NullKeyword

// An object made only of literal values: no call, identifier or spread can compute anything.
function isLiteralObject(node) {
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        (isLiteral(property.initializer) || isLiteralObject(property.initializer))
    )
  )
}

// A refusal stub: `new Response(null, { status: 405, headers: { ...literals } })` and nothing else.
// Every part is a literal, so it starts no work and needs no guard; the proxy answers 404 for the
// whole Console path earlier when it is off. An explicit method that is not a literal stub is
// guarded like any other handler.
function isMethodRefusal(body) {
  const only = body?.statements?.length === 1 ? body.statements[0] : undefined
  const expression = only && ts.isReturnStatement(only) ? only.expression : undefined
  if (!expression || !ts.isNewExpression(expression)) return false
  if (!ts.isIdentifier(expression.expression) || expression.expression.text !== 'Response')
    return false
  const [payload, init, ...rest] = expression.arguments ?? []
  if (rest.length > 0 || !payload || payload.kind !== ts.SyntaxKind.NullKeyword) return false
  if (!init || !isLiteralObject(init)) return false
  return init.properties.some(
    (property) =>
      property.name.text === 'status' &&
      ts.isNumericLiteral(property.initializer) &&
      property.initializer.text === '405'
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
  let guarded = 0
  for (const entry of exportedFunctions(source)) {
    const relevant =
      kind === 'page'
        ? entry.name === 'default' || METADATA_EXPORTS.has(entry.name)
        : HTTP_METHODS.has(entry.name)
    if (!relevant) continue
    const first = entry.body?.statements[0]
    if (kind === 'route' && isMethodRefusal(entry.body)) continue
    guarded += 1
    if (!first || !isCall(first, guard, { returned: kind !== 'page' })) {
      const form = kind === 'page' ? `${guard}()` : `${guard}(request, <function>)`
      problems.push(`${file}: export "${entry.name}" must start with ${form}`)
    }
  }
  if (guarded > 0 && declaresLocally(source, guard)) {
    problems.push(`${file}: ${guard} is declared in this file; import it from ${GUARD_MODULE}`)
  } else if (guarded > 0 && !importsGuard(source, guard)) {
    problems.push(`${file}: ${guard} must be imported from ${GUARD_MODULE}`)
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
