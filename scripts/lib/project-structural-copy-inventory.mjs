import ts from 'typescript'

const BROAD_NODE = [
  /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+\s*\(/,
  /(?:^|\n)\s*(?:describe|it|test)(?:\.each(?:<[^>]+>)?\([^\n]*\))?\s*\(/,
  /(?:^|\n)\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/,
]

function templateText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (!ts.isTemplateExpression(node)) return undefined
  return node.getText()
}

function moduleCandidates(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const candidates = []
  const visit = (node) => {
    const text = templateText(node)
    if (text?.includes('\n') && BROAD_NODE.some((pattern) => pattern.test(text))) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree))
      candidates.push({ file, line: line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return candidates
}

export function structuralCopyCandidates(sources) {
  return sources.flatMap(([file, source]) => moduleCandidates(file, source))
}
