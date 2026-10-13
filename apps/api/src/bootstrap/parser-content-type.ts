import { HttpException } from '@nestjs/common'
import { parse } from 'content-type'

const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+"
const PARAMETER = new RegExp(
  String.raw`;[\t ]*(${TOKEN})[\t ]*=[\t ]*(${TOKEN}|"(?:[\t !#-\[\]-~\x80-\xff]|\\[\t \x21-\x7e\x80-\xff])*")[\t ]*`,
  'gy'
)
const MEDIA = new RegExp(`^${TOKEN}/${TOKEN}$`)

/** Validate complete grammar before using the maintained, deliberately lenient parameter parser. */
export function parserContentType(header: string): ReturnType<typeof parse> {
  const separator = header.indexOf(';')
  const media = (separator < 0 ? header : header.slice(0, separator)).trim()
  if (!MEDIA.test(media)) throw new HttpException('Invalid Content-Type', 400)
  let index = separator < 0 ? header.length : separator
  const names = new Set<string>()
  while (index < header.length) {
    PARAMETER.lastIndex = index
    const match = PARAMETER.exec(header)
    if (!match || match.index !== index) throw new HttpException('Invalid Content-Type', 400)
    const name = match[1]!.toLowerCase()
    if (names.has(name)) throw new HttpException('Duplicate Content-Type parameter', 400)
    names.add(name)
    index = PARAMETER.lastIndex
  }
  return parse(header)
}
