import ts from 'typescript'

function unwrap(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node))
  ) {
    node = node.expression
  }
  return node
}

/** Intentionally resolves local const tuples only, not arbitrary JavaScript. */
function namesFrom(expression, constants) {
  let node = unwrap(expression)
  if (node && ts.isIdentifier(node)) {
    const declaration = constants.get(node.text)
    if (!declaration) return null
    let scope = declaration.parent
    while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent
    if (!scope || node.pos < scope.pos || node.end > scope.end) return null
    node = unwrap(declaration.initializer)
  }
  if (!node || !ts.isArrayLiteralExpression(node)) return null
  return node.elements.every(ts.isStringLiteral)
    ? node.elements.map((element) => element.text)
    : null
}

export function checkMessageSelections(text, filename, catalogueNames) {
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const constants = new Map()
  const components = new Map()
  const errors = []
  const roots = []
  let sections = 0
  const report = (node, message) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    errors.push(`${filename}:${line + 1}: ${message}`)
  }
  function inventory(node) {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name)
    ) {
      const constant = ts.isVariableDeclaration(node) && node.parent.flags & ts.NodeFlags.Const
      // Reject ambiguous/shadowed bindings rather than pretending to resolve JS scopes.
      constants.set(node.name.text, constant && !constants.has(node.name.text) ? node : null)
    }
    if (
      ts.isImportDeclaration(node) &&
      /(?:^|\/)client-message-boundary$/.test(node.moduleSpecifier.text)
    ) {
      const bindings = node.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings))
        report(node, 'Use named message-boundary imports')
      else
        for (const item of bindings.elements) {
          components.set(item.name.text, (item.propertyName ?? item.name).text)
        }
    }
    ts.forEachChild(node, inventory)
  }
  inventory(source)
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName)
    ) {
      const kind = components.get(node.tagName.text)
      if (kind === 'RootClientMessages') roots.push(filename)
      if (kind === 'ClientMessages') {
        sections++
        const attributes = node.attributes.properties
        const selected = attributes.find(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === 'namespaces'
        )
        if (
          attributes.some(
            (attribute) =>
              ts.isJsxSpreadAttribute(attribute) ||
              !['namespaces', 'children'].includes(attribute.name.text)
          )
        ) {
          report(node, 'Message boundaries accept namespace names, never raw messages or spreads')
        }
        const initializer = selected?.initializer
        const names =
          initializer && ts.isJsxExpression(initializer)
            ? namesFrom(initializer.expression, constants)
            : null
        if (!names || !names.length)
          report(node, 'Select a nonempty literal list or local const tuple')
        else if (new Set(names).size !== names.length) report(node, 'Repeated namespace selection')
        else
          for (const name of names) {
            if (!catalogueNames.has(name)) report(node, `Unknown namespace: ${name}`)
          }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { errors, roots, sections }
}
