import { operationsConsoleOwnership } from './operations-console-ownership.mjs'

function uniqueIndex(text, needle, label) {
  const first = text.indexOf(needle)
  const last = text.lastIndexOf(needle)
  if (first < 0 || first !== last) {
    throw new Error(`${label} expected exactly one anchor`)
  }
  return first
}

function lineStart(text, index) {
  return text.lastIndexOf('\n', index - 1) + 1
}

function lineEnd(text, index) {
  const end = text.indexOf('\n', index)
  return end < 0 ? text.length : end + 1
}

function removeSelector(text, seam) {
  const { selector } = seam
  if (selector.text) {
    const match = uniqueIndex(text, selector.text, seam.id)
    return text.slice(0, lineStart(text, match)) + text.slice(lineEnd(text, match))
  }
  const startMatch = uniqueIndex(text, selector.start, `${seam.id} start`)
  const endMatch = uniqueIndex(text, selector.end, `${seam.id} end`)
  if (endMatch <= startMatch) throw new Error(`${seam.id} end precedes start`)
  const start = lineStart(text, startMatch)
  let end = selector.retainEnd ? lineStart(text, endMatch) : lineEnd(text, endMatch)
  if (selector.preserveFinalNewline && end === text.length && text.endsWith('\n')) end -= 1
  if (selector.consumeBlankLine && text[end] === '\n') end += 1
  return text.slice(0, start) + text.slice(end)
}

function seamsFor(operationKey) {
  return operationsConsoleOwnership.seams.filter(
    (seam) => seam.disposition === 'remove' && seam.operationKey === operationKey
  )
}

export function consoleOwnedBlockDefinition(operationKey) {
  const seams = seamsFor(operationKey)
  if (!seams.length || seams.some((seam) => seam.seamKind !== 'owned-block')) return undefined
  return {
    claims: () => seams.map((seam) => ({ location: `ownership:seam:${seam.id}`, value: 'absent' })),
    apply: (text) => seams.reduce(removeSelector, text),
  }
}
