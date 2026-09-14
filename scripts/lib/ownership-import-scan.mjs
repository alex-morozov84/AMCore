import path from 'node:path'

import ts from 'typescript'

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.json')) return ts.ScriptKind.JSON
  return file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS
}

function staticText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined
}

function record(records, node, specifier, dynamic) {
  const start = typeof node.getStart === 'function' ? node.getStart() : node.pos
  const end = typeof node.getEnd === 'function' ? node.getEnd() : node.end
  records.push({ specifier, dynamic, start, end })
}

function scanCall(node, records, unresolvedDynamic) {
  if (!ts.isCallExpression(node)) return
  const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
  if (!isDynamic && !isRequire) return
  const argument = node.arguments[0]
  const specifier = argument && staticText(argument)
  if (specifier) record(records, argument, specifier, isDynamic)
  else unresolvedDynamic.push({ start: node.getStart(), end: node.getEnd() })
}

function scanNode(node, records, unresolvedDynamic) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    record(records, node.moduleSpecifier, staticText(node.moduleSpecifier), false)
  } else if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const expression = node.moduleReference.expression
    if (expression) record(records, expression, staticText(expression), false)
  }
  scanCall(node, records, unresolvedDynamic)
  ts.forEachChild(node, (child) => scanNode(child, records, unresolvedDynamic))
}

export function scanImports(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind(file))
  const records = []
  const unresolvedDynamic = []
  scanNode(source, records, unresolvedDynamic)
  const references = ts.preProcessFile(content, true, true).referencedFiles
  for (const reference of references) record(records, reference, reference.fileName, false)
  const barrel =
    source.statements.some((statement) => ts.isExportDeclaration(statement)) &&
    source.statements.every(isBarrelStatement)
  return { records: records.filter((item) => item.specifier), unresolvedDynamic, barrel }
}

function isBarrelStatement(statement) {
  return (
    ts.isImportDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isExportAssignment(statement)
  )
}

export function isSourceFile(file) {
  return /\.(?:[cm]?[jt]sx?)$/.test(path.extname(file)) || /\.(?:mjs|cjs|mts|cts)$/.test(file)
}
