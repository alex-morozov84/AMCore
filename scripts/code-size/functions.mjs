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

function wrapperParts(node) {
  if (ts.isIdentifier(node)) return [node.text]
  if (ts.isPropertyAccessExpression(node)) {
    const parts = wrapperParts(node.expression)
    return parts && [...parts, node.name.text]
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text === 'each' ? wrapperParts(node.expression) : null
  }
  return null
}

function isWrapperCall(node) {
  const parts = wrapperParts(node)
  if (!parts || !['describe', 'test', 'it'].includes(parts[0])) return false
  if (parts[0] === 'test' && parts[1] === 'describe') parts.splice(1, 1)
  return parts.slice(1).every((part) => ['only', 'skip', 'concurrent', 'each'].includes(part))
}

function isTestCallback(node) {
  const call = node.parent
  return (
    ts.isCallExpression(call) && call.arguments.includes(node) && isWrapperCall(call.expression)
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
