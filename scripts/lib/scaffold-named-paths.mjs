export function assertNamedPaths(name, expected, actual) {
  const present = new Set(actual)
  const wanted = new Set(expected)
  const missing = expected.filter((path) => !present.has(path))
  const unexpected = [...actual].filter((path) => !wanted.has(path)).sort()
  if (!missing.length && !unexpected.length) return
  throw new Error(`${name}: missing [${missing.join(', ')}]; unexpected [${unexpected.join(', ')}]`)
}
