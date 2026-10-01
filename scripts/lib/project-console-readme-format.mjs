// Console removal changes the longest description in this one retained table.
// Compact padding after all README edits so Storybook's exact input stays intact.
export function compactConsoleReadmeTable(text) {
  const lines = text.split('\n')
  const headings = lines.flatMap((line, index) =>
    line === '### Frontend Starter Capabilities' ? [index] : []
  )
  if (headings.length !== 1) throw new Error('expected exactly one frontend capabilities heading')
  const start = headings[0] + 2
  if (!lines[start]?.startsWith('| Capability '))
    throw new Error('missing frontend capabilities table')
  let end = start
  while (lines[end]?.startsWith('|')) end += 1
  const table = lines.slice(start, end)
  if (table.length < 3 || !/^\| [- ]+\| [- ]+\| -+ \|$/.test(table[1])) {
    throw new Error('invalid frontend capabilities table separator')
  }
  const cells = table.filter((_, index) => index !== 1)
  const padding = cells.map((line) => line.match(/( +)\|$/)?.[1].length)
  if (padding.some((width) => width === undefined)) throw new Error('missing final-cell padding')
  const shrink = Math.min(...padding) - 1
  if (shrink > 0) {
    for (let index = start; index < end; index += 1) {
      const line = lines[index]
      const suffix = index === start + 1 ? ' |' : '|'
      lines[index] = line.slice(0, -suffix.length - shrink) + suffix
    }
  }
  return lines.join('\n')
}
