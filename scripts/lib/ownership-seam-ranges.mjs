function textRanges(content, value) {
  const ranges = []
  let start = content.indexOf(value)
  while (start >= 0) {
    ranges.push({ start, end: start + value.length })
    start = content.indexOf(value, start + value.length)
  }
  return ranges
}

function blockRanges(content, selector) {
  const starts = textRanges(content, selector.start)
  return starts.map(({ start }) => {
    const endStart = content.indexOf(selector.end, start + selector.start.length)
    return { start, end: endStart + selector.end.length }
  })
}

export function seamRanges(content, seam) {
  const selector = seam.selector
  if (selector.start) return blockRanges(content, selector)
  if (selector.text) return textRanges(content, selector.text)
  if (selector.identifiers) {
    return selector.identifiers.flatMap((identifier) => textRanges(content, identifier))
  }
  const key = JSON.stringify(selector.jsonPath.at(-1))
  return textRanges(content, key)
}

export function rangesOverlap(left, right) {
  return left.start < right.end && right.start < left.end
}

export function identifierOccurrences(content, identifier) {
  return textRanges(content, identifier).map((range) => ({ ...range, detector: identifier }))
}
