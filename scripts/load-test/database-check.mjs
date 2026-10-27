// Client-specific TLS and endpoint checks. Never include credentials in diagnostics.
export const CA = '/etc/amcore/db-ca/ca.crt'
const one = (url, key, value) =>
  url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value

export function databaseProblem(service, key, definition, reference) {
  const value = definition.environment?.[key]
  const label = `${service}: ${key}`
  if (!value || !URL.canParse(value)) return `${label} is empty or not a URL`
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'postgres')
    return `${label} points outside this project's postgres`
  if (url.port && url.port !== '5432') return `${label} uses another database port`
  if (url.pathname !== reference?.pathname) return `${label} uses another database name`
  if (definition.environment?.E2E_DATABASE_URL) return `${label} has an alternate E2E_DATABASE_URL`
  if (url.hash) return `${label} has an unsupported URL fragment`
  const native = service === 'migrate'
  const expected = native
    ? { sslmode: 'require', sslaccept: 'strict', sslcert: CA }
    : { sslmode: 'verify-full', sslrootcert: CA }
  for (const [name, required] of Object.entries(expected))
    if (!one(url, name, required)) return `${label} lacks ${name}=${required} or repeats it`
  for (const name of url.searchParams.keys())
    if (!(name in expected)) return `${label} has unsupported connection parameters`
  const ca = (definition.volumes ?? []).find((m) => m.target === '/etc/amcore/db-ca')
  if (!ca?.read_only || ca.type !== 'bind' || !ca.source)
    return `${label} lacks a read-only CA mount`
  if (native && (url.username !== reference?.username || url.password !== reference?.password))
    return `${label} differs from the pg migrator credential`
  return undefined
}
