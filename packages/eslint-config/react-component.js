import { createRequire } from 'node:module'

export function reactVersion(context) {
  const settings = context.settings.react ?? {}
  let version = settings.version ?? settings.defaultVersion ?? '999.999.999'
  if (version === 'detect') {
    try {
      version = createRequire(context.filename)('react/package.json').version
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
      version = settings.defaultVersion ?? '999.999.999'
    }
  }
  return String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

export function atLeast(version, minimum) {
  const expected = minimum.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = (version[index] ?? 0) - (expected[index] ?? 0)
    if (difference) return difference > 0
  }
  return true
}

export function reactPragma(context) {
  const comment = context.sourceCode
    .getAllComments()
    .map((node) => /@jsx\s+([^\s]+)/.exec(node.value))
    .find(Boolean)
  const pragma = comment?.[1].split('.')[0] ?? context.settings.react?.pragma ?? 'React'
  return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(pragma) ? pragma : 'React'
}

export function componentProperties(node, context, pragma) {
  if (node.type === 'ObjectExpression') {
    const callee = node.parent?.callee
    const createClass = context.settings.react?.createClass ?? 'createReactClass'
    if (!/^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(createClass))
      throw new Error('Invalid createClass pragma')
    const matches =
      callee?.type === 'MemberExpression'
        ? callee.object.name === pragma && callee.property.name === createClass
        : callee?.name === createClass
    return matches ? node.properties : []
  }
  const parent = node.superClass
  const direct =
    parent?.type === 'MemberExpression'
      ? parent.object.name === pragma && /^(Pure)?Component$/.test(parent.property.name)
      : parent?.type === 'Identifier' && /^(Pure)?Component$/.test(parent.name)
  const declaration = node.parent?.type.startsWith('Export') ? node.parent : node
  const comment = context.sourceCode.getCommentsBefore(declaration).at(-1)
  const explicit =
    comment?.value.startsWith('*') &&
    /@(extends|augments)\s+(?:\{)?React\.(?:Pure)?Component\b/.test(comment.value)
  return direct || explicit ? node.body.body : []
}
