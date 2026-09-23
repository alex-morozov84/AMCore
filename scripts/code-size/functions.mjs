import ts from 'typescript'

const FUNCTION_NODES = [
  ts.isFunctionDeclaration,
  ts.isFunctionExpression,
  ts.isArrowFunction,
  ts.isMethodDeclaration,
  ts.isConstructorDeclaration,
  ts.isGetAccessorDeclaration,
  ts.isSetAccessorDeclaration,
]

function scriptKind(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function rootCallName(node) {
  if (ts.isCallExpression(node)) return rootCallName(node.expression)
  if (ts.isPropertyAccessExpression(node)) return rootCallName(node.expression)
  return ts.isIdentifier(node) ? node.text : null
}

function isTestCallback(node) {
  const call = node.parent
  return (
    ts.isCallExpression(call) &&
    call.arguments.includes(node) &&
    ['describe', 'test', 'it'].includes(rootCallName(call.expression))
  )
}

function functionName(node, source) {
  if (node.name) return node.name.getText(source)
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    return parent.name.getText(source)
  }
  return '<callback>'
}

export function changedFunctions(path, text, ranges, added) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path))
  if (source.parseDiagnostics.length) {
    throw new Error(
      `${path}: TypeScript parser reported ${source.parseDiagnostics.length} error(s)`
    )
  }
  const functions = []
  function visit(node) {
    if (FUNCTION_NODES.some((check) => check(node)) && !isTestCallback(node)) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const end = source.getLineAndCharacterOfPosition(node.end - 1).line + 1
      if (added || ranges.some(([first, last]) => first <= end && last >= start)) {
        functions.push({ name: functionName(node, source), line: start, lines: end - start + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return functions
}
