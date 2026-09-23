import { storybookOwnership } from './storybook-ownership.mjs'
import { assertBlockOrder, ownedBlockPrefix } from './ownership-seams.mjs'

function uniqueIndex(text, needle, label) {
  const first = text.indexOf(needle)
  if (first < 0 || first !== text.lastIndexOf(needle)) {
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

function removeOrReplace(text, seam) {
  const { selector } = seam
  if (selector.text) {
    const match = uniqueIndex(text, selector.text, seam.id)
    return text.slice(0, lineStart(text, match)) + text.slice(lineEnd(text, match))
  }
  assertBlockOrder(text, seam, seam.path)
  const startMatch = uniqueIndex(text, selector.start, `${seam.id} start`)
  const endMatch = uniqueIndex(text, selector.end, `${seam.id} end`)
  if (endMatch < startMatch) throw new Error(`${seam.id} end precedes start`)
  const start = lineStart(text, startMatch)
  let end = lineEnd(text, endMatch)
  if (selector.consumeBlankLine && text[end] === '\n') end += 1
  const prefix = ownedBlockPrefix(text, seam, seam.path)
  const replacement = prefix
    ? prefix + selector.replacement.replace(/\n(?=.)/g, `\n${' '.repeat(prefix.length)}`)
    : (selector.replacement ?? '')
  return text.slice(0, start) + replacement + text.slice(end)
}

function seamsFor(operationKey) {
  return storybookOwnership.seams.filter(
    (seam) => seam.disposition !== 'retain' && seam.operationKey === operationKey
  )
}

export function storybookOwnedBlockDefinition(operationKey) {
  const seams = seamsFor(operationKey)
  if (!seams.length || seams.some((seam) => seam.seamKind !== 'owned-block')) return undefined
  return {
    claims: () =>
      seams.map((seam) => ({
        location: `ownership:seam:${seam.id}`,
        value: seam.disposition === 'remove' ? 'absent' : 'projected',
      })),
    apply: (text) => seams.reduce(removeOrReplace, text),
  }
}
