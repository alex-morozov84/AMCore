import { readFileSync } from 'node:fs'
import path from 'node:path'

import { localePathPrefix, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { ROUTE_SCOPED_NAMESPACES } from '../../src/i18n/route-scoped-namespaces'

type Catalogue = Record<string, unknown>

function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(leaves)
}

/** A string as it appears inside the serialized RSC payload embedded in the HTML. */
const embedded = (text: string) => JSON.stringify(JSON.stringify(text)).slice(3, -3)

/**
 * The root client provider carries every page's messages in its HTML. Route-scoped
 * namespaces are delivered only by their own nested provider, so a public page must not
 * contain any string that exists only in them (src/i18n/client-messages.ts).
 */
for (const locale of SUPPORTED_LOCALES) {
  test(`login HTML carries no route-scoped messages (${locale})`, async ({ request }) => {
    const catalogue = JSON.parse(
      readFileSync(path.join(__dirname, `../../messages/${locale}.json`), 'utf8')
    ) as Catalogue
    const shared = new Set(
      Object.entries(catalogue)
        .filter(([namespace]) => !ROUTE_SCOPED_NAMESPACES.includes(namespace))
        .flatMap(([, value]) => leaves(value))
    )
    const html = await (await request.get(`${localePathPrefix(locale)}/login`)).text()

    // Positive control: root messages that client components need are present.
    expect(html).toContain(embedded(leaves(catalogue.common)[0]!))
    for (const namespace of ROUTE_SCOPED_NAMESPACES) {
      // Only text no root message contains, so a shared plural fragment is not a false hit.
      const unique = leaves(catalogue[namespace]).filter(
        (text) => text.length > 24 && ![...shared].some((other) => other.includes(text))
      )
      const leaked = unique.filter((text) => html.includes(embedded(text)) || html.includes(text))
      expect(leaked, `${namespace} strings in login HTML`).toEqual([])
    }
  })
}
