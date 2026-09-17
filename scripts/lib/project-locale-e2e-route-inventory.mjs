import ts from 'typescript'

const ROUTE_PREFIX = /(\\?\/)(?:en|ru|\(en\|ru\))(?=\\?\/|[?'"`)\]}(\s]|$)/g

function matches(text) {
  return [...text.matchAll(ROUTE_PREFIX)]
}

function routeNode(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node) ||
    ts.isRegularExpressionLiteral(node)
  )
}

function literalReferences(sourceFile) {
  const found = []
  const visit = (node) => {
    if (routeNode(node)) {
      const text = node.getText(sourceFile)
      if (matches(text).length) found.push({ kind: 'literal', node, text })
      if (ts.isTemplateExpression(node)) return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function commentReferences(text, sourceFile) {
  const ranges = new Map()
  const retain = (range) => ranges.set(`${range.pos}:${range.end}`, range)
  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) retain(range)
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) retain(range)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...ranges.values()].map(({ pos: start, end }) => ({
    kind: 'comment',
    start,
    end,
    text: text.slice(start, end),
  }))
}

export function routeReferenceInventory(model) {
  const references = [
    ...literalReferences(model.sourceFile),
    ...commentReferences(model.text, model.sourceFile),
  ]
  return {
    references,
    count: references.reduce((total, item) => total + matches(item.text).length, 0),
  }
}

export function weakRootAssertionCount(model) {
  let count = 0
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText().endsWith('.toHaveURL') &&
      node.arguments.length === 1 &&
      node.arguments[0].getText() === String.raw`/\/?$/`
    ) {
      count += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(model.sourceFile)
  return count
}

export function rewriteRoutePrefixes(text) {
  return text.replace(ROUTE_PREFIX, (match, slash, offset, input) => {
    const tail = input.slice(offset + match.length)
    return tail.startsWith('/') || tail.startsWith('\\/') ? '' : slash
  })
}

export function commentRange(reference) {
  return { getStart: () => reference.start, end: reference.end }
}
