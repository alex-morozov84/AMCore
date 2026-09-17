import { deleteJsonPath, replaceCapturedField, setJsonPath, setMarkdownField } from './actions.mjs'

function tagged(adapterClass, transform) {
  transform.adapterClass = adapterClass
  return transform
}

export function markdownFieldsTransform(operations) {
  return tagged('structured-config', (content) =>
    operations.reduce((current, operation) => setMarkdownField(current, operation), content)
  )
}

export function linePatchesTransform(operations) {
  return tagged('structured-config', (content) =>
    operations.reduce(
      (current, operation) => replaceCapturedField(current, operation.regex, operation.value),
      content
    )
  )
}

export function jsonPatchTransform(patches) {
  return tagged('structured-config', (content) => {
    const document = JSON.parse(content)
    for (const [key, value] of Object.entries(patches)) setJsonPath(document, key, value)
    return `${JSON.stringify(document, null, 2)}\n`
  })
}

export function jsonDeleteTransform(paths) {
  return tagged('structured-config', (content) => {
    const document = JSON.parse(content)
    for (const pathname of paths) deleteJsonPath(document, pathname)
    return `${JSON.stringify(document, null, 2)}\n`
  })
}
