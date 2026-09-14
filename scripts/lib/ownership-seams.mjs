import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'
import { readInventoryFile } from './ownership-inventory.mjs'

function countText(content, value) {
  return content.split(value).length - 1
}

function jsonFieldExists(content, selector) {
  let value = JSON.parse(content)
  for (const key of selector) {
    if (value === null || !Object.hasOwn(value, key)) return false
    value = value[key]
  }
  return true
}

function selectorCount(content, seam) {
  if (seam.selector.jsonPath) return jsonFieldExists(content, seam.selector.jsonPath) ? 1 : 0
  if (seam.selector.text) return countText(content, seam.selector.text)
  if (seam.selector.start) return countText(content, seam.selector.start)
  return seam.selector.identifiers.reduce((sum, id) => sum + countText(content, id), 0)
}

function assertBlockOrder(content, seam) {
  const { start, end } = seam.selector
  if (!start || !end) return
  const expected = expectedOccurrences(seam)
  if (countText(content, start) !== expected || countText(content, end) !== expected) {
    throw ownershipError(OWNERSHIP_CODES.CARDINALITY, `seam ${seam.id} block cardinality drifted`)
  }
  const startIndex = content.indexOf(start)
  const endIndex = content.indexOf(end, startIndex + start.length)
  if (startIndex >= 0 && endIndex >= startIndex) return
  throw ownershipError(OWNERSHIP_CODES.CARDINALITY, `seam ${seam.id} has invalid block anchors`)
}

function expectedOccurrences(seam) {
  return seam.occurrences ?? 1
}

export function validateSeams(root, manifest, inventory) {
  for (const seam of manifest.seams) {
    for (const file of inventory.matches.get(seam)) {
      const content = readInventoryFile(root, file)
      assertBlockOrder(content, seam)
      const count = selectorCount(content, seam)
      if (count !== expectedOccurrences(seam)) {
        throw ownershipError(
          OWNERSHIP_CODES.CARDINALITY,
          `seam ${seam.id} expected ${expectedOccurrences(seam)} semantic matches, found ${count}`,
          [file]
        )
      }
    }
  }
}

export function seamCoversDetector(seam, detector) {
  return seam.detectors.includes(detector)
}
