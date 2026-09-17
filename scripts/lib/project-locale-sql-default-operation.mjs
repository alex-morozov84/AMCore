const DEFAULT = /ALTER\s+COLUMN\s+"locale"\s+SET\s+DEFAULT\s+'([^']+)'/g
const COMMENT_START = "-- AMCore's base locale is English;"
const COMMENT_END = '-- (`ru` / `Europe/Moscow`) so a fresh install is locale-neutral.'

function uniqueMatch(text, pattern, description) {
  const matches = [...text.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(`${description} expected exactly one match, found ${matches.length}`)
  }
  return matches[0]
}

function commentRange(text) {
  const start = text.indexOf(COMMENT_START)
  const endStart = text.indexOf(COMMENT_END)
  const duplicate = text.indexOf(COMMENT_START, start + 1)
  if (start < 0 || endStart < start || duplicate >= 0) {
    throw new Error('SQL locale-default comment expected exactly one ordered block')
  }
  return { start, end: endStart + COMMENT_END.length }
}

function replaceDefault(text, match, locale) {
  const start = match.index + match[0].lastIndexOf(match[1])
  return text.slice(0, start) + locale + text.slice(start + match[1].length)
}

export function projectSqlLocaleDefault(text, { locale }) {
  const match = uniqueMatch(text, DEFAULT, 'SQL users.locale SET DEFAULT')
  const comments = commentRange(text)
  if (match[1] !== 'en') throw new Error('SQL users.locale default must start as en')
  if (locale === 'en') return text
  const afterDefault = replaceDefault(text, match, locale)
  const replacement =
    '-- This single-locale fork uses Russian as its base locale. The scaffold keeps\n' +
    '-- the new-row locale default aligned with DEFAULT_LOCALE while preserving the\n' +
    '-- upstream migration identity and the UTC timezone default.'
  return afterDefault.slice(0, comments.start) + replacement + afterDefault.slice(comments.end)
}

export function readSqlLocaleDefault(text) {
  return uniqueMatch(text, DEFAULT, 'SQL users.locale SET DEFAULT')[1]
}
