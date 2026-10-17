const setting = 'client_connection_check_interval'
const requiredMilliseconds = 50

// PostgreSQL startup options use whitespace and backslash escaping, not shell quoting.
function tokens(options) {
  if (options.includes('\0')) throw new Error('Malformed migration startup options')
  const result = []
  let token = ''
  for (let index = 0; index < options.length; index++) {
    const character = options[index]
    if (character === '\\') {
      if (++index === options.length) throw new Error('Malformed migration startup options')
      token += options[index]
    } else if (/[ \t\n\r\f\v]/.test(character)) {
      if (token) result.push(token)
      token = ''
    } else {
      token += character
    }
  }
  if (token) result.push(token)
  return result
}

function milliseconds(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d)?$/.exec(value)
  if (!match) return undefined
  const units = { us: 0.001, ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 }
  return Number(match[1]) * units[match[2] ?? 'ms']
}

function hasRequiredSetting(options) {
  const args = tokens(options)
  let found = false
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    const argument = token === '-c' ? args[++index] : /^(?:-c|--)(.+)$/.exec(token)?.[1]
    if (argument === undefined && token !== '-c') continue
    const equals = argument?.indexOf('=') ?? -1
    if (equals <= 0) throw new Error('Malformed migration startup options')
    const name = argument.slice(0, equals).trim().toLowerCase().replaceAll('-', '_')
    if (name !== setting) continue
    if (found || milliseconds(argument.slice(equals + 1).trim()) !== requiredMilliseconds)
      throw new Error('Conflicting migration disconnect-check setting')
    found = true
  }
  return found
}

export function migrationConnectionUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Migration datasource requires a valid PostgreSQL URL')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Migration datasource requires a PostgreSQL URL')
  if (url.searchParams.get('pgbouncer') === 'true')
    throw new Error('Migration datasource requires a direct PostgreSQL endpoint')
  const options = url.searchParams.getAll('options')
  if (options.length > 1) throw new Error('Duplicate migration startup options')
  const existing = options[0] ?? ''
  if (tokens(existing).includes('--')) throw new Error('Malformed migration startup options')
  if (!hasRequiredSetting(existing)) {
    const separator = existing ? ' ' : ''
    url.searchParams.set('options', `${existing}${separator}-c ${setting}=50ms`)
  }
  return url.href
}
