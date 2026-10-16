import { parse as parseFlatForm } from 'node:querystring'

import { HttpException } from '@nestjs/common'
import iconv from 'iconv-lite'
import qs from 'qs'

import { PayloadTooLargeException } from '../common/exceptions/domain/index.js'

import { parserContentType } from './parser-content-type.js'

export function decodeBody(
  body: Buffer,
  header: string,
  json: boolean
): {
  text: string
  charset: 'utf-8' | 'iso-8859-1' | string
} {
  const charset = parserContentType(header).parameters.charset?.toLowerCase() ?? 'utf-8'
  const allowed = json
    ? charset.startsWith('utf-') && iconv.encodingExists(charset)
    : charset === 'utf-8' || charset === 'iso-8859-1'
  if (!allowed) throw new HttpException('Unsupported content charset', 415)
  return { text: iconv.decode(body, charset), charset }
}

export function parseNativeForm(body: Buffer, header: string, flat: boolean): unknown {
  const { text, charset } = decodeBody(body, header, false)
  const parameters = text.length ? text.split('&').length : 0
  if (parameters > 1000)
    throw new PayloadTooLargeException('Too many form parameters', { parameterLimit: 1000 })
  if (flat) {
    const parsed = parseFlatForm(text, '&', '=', {
      maxKeys: 1000,
      decodeURIComponent: (value) =>
        String(
          qs.parse(`value=${value}`, {
            charset: charset as 'utf-8' | 'iso-8859-1',
            allowPrototypes: false,
          }).value ?? ''
        ),
    })
    for (const key of Object.keys(parsed)) {
      if (
        Object.hasOwn(Object.prototype, key) ||
        /(?:^|\[)(?:__proto__|constructor|prototype)(?:\[|\]|$)/.test(key)
      )
        delete parsed[key]
    }
    return parsed
  }
  try {
    return qs.parse(text, {
      charset: charset as 'utf-8' | 'iso-8859-1',
      depth: 32,
      parameterLimit: 1000,
      arrayLimit: Math.max(100, parameters),
      strictDepth: true,
      allowPrototypes: false,
    })
  } catch (error) {
    if (error instanceof RangeError) throw new HttpException('Form nesting exceeds the limit', 400)
    throw error
  }
}
