import { HttpException } from '@nestjs/common'
import iconv from 'iconv-lite'

import { decodeBody, parseNativeForm } from './native-body-values'
import { parserContentType } from './parser-content-type'

describe('H-P structured media and decoded values', () => {
  it.each(['UTF-8', 'utf-16le', 'utf-16be', 'utf-16', 'utf-32le', 'utf-32be', 'utf-32'])(
    'preserves supported byte encoding %s',
    (charset) => {
      const text = '{"name":"éЖ😀"}'
      expect(
        decodeBody(iconv.encode(text, charset), `application/json; charset="${charset}"`, true).text
      ).toBe(text)
    }
  )
  it.each([
    'application/json; xcharset=ascii',
    'application/json; note="charset=ascii"',
    'APPLICATION/JSON; CHARSET="utf-8"; note="a; b"',
  ])('reads only the real charset parameter: %s', (header) => {
    expect(decodeBody(Buffer.from('{}'), header, true).text).toBe('{}')
  })
  it.each([
    'application/json; charset=utf-8; charset=utf-16',
    'application/json; bad',
    'application/json; note="unterminated',
    'application/json; =utf-8',
    'application/json, text/plain',
  ])('rejects ambiguous or malformed media grammar: %s', (header) => {
    expect(() => parserContentType(header)).toThrow(HttpException)
  })
  it.each(['', 'utf-does-not-exist', 'iso-8859-1'])(
    'rejects unsupported JSON charset415: %s',
    (charset) => {
      expect(() =>
        decodeBody(Buffer.from('{}'), `application/json; charset="${charset}"`, true)
      ).toThrow(expect.objectContaining({ status: 415 }))
    }
  )
  it.each([false, true])('preserves Latin1 raw/percent/repeated fields (flat=%s)', (flat) => {
    const body = Buffer.from('value=%E9&raw=é&repeat=a&repeat=b&plus=a+b', 'latin1')
    expect(
      parseNativeForm(body, 'application/x-www-form-urlencoded; charset=iso-8859-1', flat)
    ).toEqual({ value: 'é', raw: 'é', repeat: ['a', 'b'], plus: 'a b' })
  })
  it('keeps indexed arrays at the supported control limit', () => {
    expect(
      parseNativeForm(Buffer.from('items[21]=x'), 'application/x-www-form-urlencoded', false)
    ).toEqual({ items: ['x'] })
  })
  it('preserves bracket literals and null prototype in flat forms', () => {
    const value = parseNativeForm(
      Buffer.from('items[21]=x'),
      'application/x-www-form-urlencoded',
      true
    )
    expect(value).toEqual({ 'items[21]': 'x' })
    expect(Object.getPrototypeOf(value)).toBeNull()
  })
  it.each([false, true])(
    'filters root/nested/encoded prototype-shadowing form keys (flat=%s)',
    (flat) => {
      const value = parseNativeForm(
        Buffer.from(
          '__proto__[polluted]=yes&constructor[prototype][polluted]=yes&nested[%5f%5fproto%5f%5f][polluted]=yes&ok=yes'
        ),
        'application/x-www-form-urlencoded',
        flat
      )
      expect(value).toEqual({ ok: 'yes' })
      expect(Object.prototype).not.toHaveProperty('polluted')
    }
  )
  it.each([false, true])('bounds1000/1001 parameters (flat=%s)', (flat) => {
    const form = Array.from({ length: 1000 }, (_, i) => `key${i}=x`).join('&')
    expect(
      Object.keys(
        parseNativeForm(Buffer.from(form), 'application/x-www-form-urlencoded', flat) as object
      )
    ).toHaveLength(1000)
    expect(() =>
      parseNativeForm(Buffer.from(form + '&extra=x'), 'application/x-www-form-urlencoded', flat)
    ).toThrow('Too many form parameters')
  })
})
