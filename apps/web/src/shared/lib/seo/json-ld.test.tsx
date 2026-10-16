import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { JsonLd, serializeJsonLd } from './json-ld'

const hostile = { '@context': 'https://schema.org', '@type': 'Thing', name: 'a</script><b>x' }

describe('serializeJsonLd', () => {
  it('contains no raw less-than sign, so a value cannot close the script tag', () => {
    const text = serializeJsonLd(hostile)
    expect(text).not.toContain('<')
    expect(text).toContain('\\u003c/script>')
  })

  it('round-trips through JSON.parse to the original value', () => {
    expect(JSON.parse(serializeJsonLd(hostile))).toEqual(hostile)
  })
})

describe('JsonLd', () => {
  it('renders one ld+json script whose only closing tag is its own', () => {
    const html = renderToStaticMarkup(<JsonLd data={hostile} />)
    expect(html.startsWith('<script type="application/ld+json">')).toBe(true)
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).not.toContain('<b>')
    const text = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))
    expect(JSON.parse(text)).toEqual(hostile)
  })
})
