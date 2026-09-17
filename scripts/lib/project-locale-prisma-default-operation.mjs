const USER_MODEL = /^model\s+User\s+\{$/
const LOCALE_FIELD = /^(\s*locale\s+String\s+@default\(")([^"]+)("\)\s*)$/
const COMMENT = '// Neutral starter defaults for a new row only.'

function records(text) {
  let offset = 0
  return text.split(/(?<=\n)/).map((value) => {
    const record = { value, start: offset, end: offset + value.length }
    offset = record.end
    return record
  })
}

function unique(items, description) {
  if (items.length !== 1) {
    throw new Error(`${description} expected exactly one match, found ${items.length}`)
  }
  return items[0]
}

function userModelRange(lines) {
  const start = unique(
    lines.flatMap((line, index) => (USER_MODEL.test(line.value.trimEnd()) ? [index] : [])),
    'Prisma User model'
  )
  const end = lines.findIndex((line, index) => index > start && line.value.trim() === '}')
  if (end < 0) throw new Error('Prisma User model has no closing brace')
  return { start, end }
}

function localeField(lines, range) {
  return unique(
    lines.slice(range.start + 1, range.end).flatMap((line) => {
      const match = LOCALE_FIELD.exec(line.value.trimEnd())
      return match ? [{ line, match }] : []
    }),
    'Prisma User.locale @default field'
  )
}

function localeComment(lines, field) {
  const fieldIndex = lines.indexOf(field.line)
  return unique(
    lines
      .slice(Math.max(0, fieldIndex - 6), fieldIndex)
      .filter((line) => line.value.trim().startsWith(COMMENT)),
    'Prisma User.locale default comment'
  )
}

function replaceRanges(text, changes) {
  return [...changes]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (output, change) => output.slice(0, change.start) + change.value + output.slice(change.end),
      text
    )
}

export function projectPrismaLocaleDefault(text, { locale }) {
  const lines = records(text)
  const field = localeField(lines, userModelRange(lines))
  const comment = localeComment(lines, field)
  if (field.match[2] !== 'en') throw new Error('Prisma User.locale default must start as en')
  if (locale === 'en') return text
  const fieldValue = field.line.value.replace(LOCALE_FIELD, `$1${locale}$3`)
  const commentValue = comment.value.replace(
    COMMENT,
    '// Selected RU starter defaults for a new row only.'
  )
  return replaceRanges(text, [
    { start: field.line.start, end: field.line.end, value: fieldValue },
    { start: comment.start, end: comment.end, value: commentValue },
  ])
}

export function readPrismaLocaleDefault(text) {
  const lines = records(text)
  return localeField(lines, userModelRange(lines)).match[2]
}
