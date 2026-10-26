type Messages = Record<string, unknown>

/** Next16/React19 Flight JSON rows only; this test decoder never evaluates scripts. */
export function serializedClientMessages(flight: string): Messages[] {
  const rows = new Map<string, unknown>()
  for (const line of flight.split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const id = line.slice(0, separator)
    const body = line.slice(separator + 1)
    try {
      rows.set(id, JSON.parse(body.startsWith('I') ? body.slice(1) : body))
    } catch {
      // Binary, text and hint rows do not carry JSON element props.
    }
  }
  const result: Messages[] = []
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      const props = value[3]
      if (value[0] === '$' && typeof value[1] === 'string' && value[1].startsWith('$L') && props) {
        let messages = props.messages
        if (typeof messages === 'string' && /^\$[a-f\d]+$/.test(messages)) {
          messages = rows.get(messages.slice(1))
        }
        if (messages && typeof messages === 'object' && !Array.isArray(messages)) {
          result.push(messages)
        }
      }
      value.forEach(visit)
    } else {
      Object.values(value).forEach(visit)
    }
  }
  rows.forEach(visit)
  return result
}

export function embeddedFlight(html: string): string {
  const chunks: string[] = []
  for (const match of html.matchAll(/self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g)) {
    const value: unknown = JSON.parse(match[1]!)
    if (Array.isArray(value) && value[0] === 1 && typeof value[1] === 'string') {
      chunks.push(value[1])
    }
  }
  if (!chunks.length)
    throw new Error('No embedded Flight stream; update the version-specific decoder')
  return chunks.join('')
}
