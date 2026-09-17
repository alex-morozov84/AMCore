import ts from 'typescript'

function leadingTrivia(text, node) {
  const fullStart = node.getFullStart()
  const comments = ts.getLeadingCommentRanges(text, fullStart) ?? []
  let triviaStart = fullStart
  let contentStart = comments[0]?.pos ?? node.getStart()
  comments.forEach((comment, index) => {
    const nextStart = comments[index + 1]?.pos ?? node.getStart()
    if (!/\n[ \t]*\n/.test(text.slice(comment.end, nextStart))) return
    triviaStart = comment.end
    contentStart = nextStart
  })
  return { triviaStart, contentStart }
}

function statementRange(text, node, { triviaStart, contentStart }) {
  const start = triviaStart + text.slice(triviaStart, contentStart).lastIndexOf('\n') + 1
  let end = node.end + /^[ \t]*(\r?\n)?/.exec(text.slice(node.end))[0].length
  const blankAfter = /^[ \t]*\r?\n/.exec(text.slice(end))
  if (blankAfter && /(^|\n)[ \t]*\n$/.test(text.slice(0, start))) end += blankAfter[0].length
  return { start, end }
}

export function removalRange(text, node, options = {}) {
  const trivia = leadingTrivia(text, node)
  const start = trivia.triviaStart
  const trailing = /^\s*,/.exec(text.slice(node.end))
  if (trailing) {
    const end = node.end + trailing[0].length
    const gap = start === node.getStart() ? /^[ \t]*/.exec(text.slice(end))[0].length : 0
    return { start, end: end + gap }
  }
  const leading = /,\s*$/.exec(text.slice(0, start))
  if (leading) return { start: leading.index, end: node.end }
  const range = statementRange(text, node, trivia)
  if (options.includeTrailingBlank && text[range.end] === '\n') range.end += 1
  if (options.includeLeadingBlank && text[range.start - 1] === '\n') range.start -= 1
  return range
}

export function replacementStart(text, node, includeLeadingComments) {
  return includeLeadingComments ? leadingTrivia(text, node).contentStart : node.getStart()
}
