import deprecations from './react-deprecations.json' with { type: 'json' }
import { atLeast, componentProperties, reactPragma, reactVersion } from './react-component.js'

const MODULES = {
  react: ['React'],
  'react-addons-perf': ['ReactPerf', 'Perf'],
  'react-dom': ['ReactDOM'],
  'react-dom/server': ['ReactDOMServer'],
}

// Preserve the legacy API policy through public ESLint10 APIs.
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      deprecated: '{{oldMethod}} is deprecated since React {{version}}{{newMethod}}{{refs}}',
    },
  },
  create(context) {
    const pragma = reactPragma(context)
    const version = reactVersion(context)
    const methods = Object.fromEntries(
      Object.entries(deprecations).map(([name, value]) => [
        name.replace(/^React\./, `${pragma}.`),
        value,
      ])
    )
    function check(node, name) {
      const entry = methods[name]
      if (!entry || !atLeast(version, entry[0])) return
      context.report({
        node,
        messageId: 'deprecated',
        data: {
          oldMethod: name,
          version: entry[0],
          newMethod: entry[1]
            ? `, use ${entry[1].replace(/\bReact\./g, `${pragma}.`)} instead`
            : '',
          refs: entry[2] ? `, see ${entry[2]}` : '',
        },
      })
    }
    function lifecycle(node) {
      for (const property of componentProperties(node, context, pragma)) {
        if (property.key?.name) check(property.key, property.key.name)
      }
    }
    return {
      MemberExpression(node) {
        check(node, context.sourceCode.getText(node))
      },
      ImportDeclaration(node) {
        const names = MODULES[node.source.value]
        if (!names) return
        for (const specifier of node.specifiers) {
          if (specifier.imported?.name) check(specifier, `${names[0]}.${specifier.imported.name}`)
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern' || !node.init) return
        const module = node.init.arguments?.[0]?.value
        const entry = Object.entries(MODULES).find(
          ([name, aliases]) => module === name || aliases.includes(node.init.name)
        )
        if (!entry) return
        for (const property of node.id.properties) {
          if (property.type !== 'RestElement' && property.key?.name) {
            check(property, `${entry[1][0]}.${property.key.name}`)
          }
        }
      },
      ClassDeclaration: lifecycle,
      ClassExpression: lifecycle,
      ObjectExpression: lifecycle,
    }
  },
}
