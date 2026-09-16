import ts from 'typescript'

import { CONFLICT_CODES, PathAlgebraConflictError } from './path-algebra-errors.mjs'
import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { ROUTE_PROGRESS_OPERATION_KEY } from './project-route-progress-ownership.mjs'

const CHOICE_MARKER = 'This fork chose `--route-progress=disabled` at scaffold time'
const CHOICE_NOTE = `*
 * ${CHOICE_MARKER}, so the bar
 * starts off. Flip the line below to \`true\` to turn it back on — and keep
 * \`PROJECT_CONTEXT.md\`'s \`frontend_route_progress\` field truthful when you do.
 `

const disabledParams = (params) =>
  params !== null &&
  typeof params === 'object' &&
  Object.keys(params).length === 1 &&
  params.enabled === false

function isExportedRouteProgressDeclaration(node) {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return false
  const statement = node.parent?.parent
  return (
    node.name.text === 'ROUTE_PROGRESS_ENABLED' &&
    ts.isVariableStatement(statement) &&
    (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  )
}

function semanticNodeError(model, ctx, count, describe) {
  const code =
    count === 0 ? CONFLICT_CODES.MISSING_SEMANTIC_NODE : CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE
  throw new PathAlgebraConflictError(code, {
    paths: [model.path],
    dimensions: [],
    detail: `operationKey "${ctx.operationKey}" expected exactly one ${describe} in "${model.path}", found ${count}`,
  })
}

function attachedJsDoc(model, declaration, ctx) {
  const docs = declaration.parent.parent.jsDoc ?? []
  if (docs.length !== 1) semanticNodeError(model, ctx, docs.length, 'attached JSDoc block')
  return docs[0]
}

function addChoiceNote(model, declaration, ctx) {
  const doc = attachedJsDoc(model, declaration, ctx)
  const text = model.text.slice(doc.getStart(model.sourceFile), doc.end)
  const markers = text.split(CHOICE_MARKER).length - 1
  if (markers > 1) semanticNodeError(model, ctx, markers, 'scaffold-choice note')
  if (markers === 1) return
  const close = text.lastIndexOf('*/')
  model.replaceNode(doc, `${text.slice(0, close)}${CHOICE_NOTE}${text.slice(close)}`, ctx)
}

function setDisabled(model, _params, ctx) {
  const declaration = findUniqueNode(model, isExportedRouteProgressDeclaration, {
    ...ctx,
    describe: 'exported const declaration named ROUTE_PROGRESS_ENABLED',
  })
  const initializer = findUniqueNode(
    model,
    (node) => node === declaration.initializer && node.kind === ts.SyntaxKind.TrueKeyword,
    { ...ctx, describe: 'true initializer for ROUTE_PROGRESS_ENABLED' },
    declaration
  )
  model.replaceNode(initializer, 'false', ctx)
  addChoiceNote(model, declaration, ctx)
}

export function registerRouteProgressStructuralOperations(registry) {
  registry.define(ROUTE_PROGRESS_OPERATION_KEY, {
    paramsSchema: disabledParams,
    deriveSemanticWrites: () => [
      { location: 'ts:exported-const:ROUTE_PROGRESS_ENABLED:initializer', value: false },
      { location: 'ts:jsdoc:ROUTE_PROGRESS_ENABLED:scaffold-choice', value: 'present' },
    ],
    adapter: setDisabled,
  })
}
