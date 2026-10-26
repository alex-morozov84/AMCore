import { removeExactBlock } from './content-blocks.mjs'

function removeBlock(text, marker) {
  const start = `<!-- ${marker}_START -->`
  const end = `<!-- ${marker}_END -->`
  if (text.split(start).length !== 2 || text.split(end).length !== 2)
    throw new Error(`Expected exactly one ${marker} block`)
  const from = text.indexOf(start)
  const to = text.indexOf(end)
  if (to <= from) throw new Error(`Invalid ${marker} block order`)
  const stop = to + end.length
  const blank = text.slice(stop).startsWith('\n\n') ? 2 : 0
  return removeExactBlock(text, text.slice(from, stop + blank))
}

export const LOCALE_DOC_DEFINITIONS = [
  ['locale.route-cache-guide', 'AMCORE_LOCALE_ROUTE_CACHE_PATCH'],
  ['locale-console.route-cache-guide', 'AMCORE_CONSOLE_ROUTE_CACHE_PATCH'],
].map(([key, marker]) => [
  key,
  {
    claims: () => [{ location: `markdown:block:${marker}`, value: 'absent' }],
    apply: (text) => removeBlock(text, marker),
  },
])
