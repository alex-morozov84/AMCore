import { setMarkdownField } from './actions.mjs'
import { jsonPatchTransform } from './content-transforms.mjs'

const field = (name, value) => ({ location: `markdown:field:${name}`, value })
const json = (name, value) => ({ location: `json:${name}`, value })

function contextClaims(params) {
  return params.fields.map(({ label, value }) => field(label, value))
}

function applyContext(content, params) {
  return params.fields.reduce((current, operation) => setMarkdownField(current, operation), content)
}

const jsonDefinition = (prefix) => ({
  claims: (params) =>
    Object.entries(params).map(([name, value]) => json(`${prefix}.${name}`, value)),
  apply: (content, params) => jsonPatchTransform(params)(content),
})

const definitions = new Map([
  ['brand.context-fields', { claims: contextClaims, apply: applyContext }],
  ['brand.package-fields', jsonDefinition('package')],
  ['brand.messages-en-meta', jsonDefinition('messages.en')],
  ['brand.messages-ru-meta', jsonDefinition('messages.ru')],
])

export function brandContentDefinition(operationKey) {
  return definitions.get(operationKey)
}
