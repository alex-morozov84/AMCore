/**
 * Escapes the three characters PostgreSQL's `LIKE`/`ILIKE` treat as pattern
 * metacharacters (`%`, `_`) plus the default escape character itself (`\`),
 * so a raw operator-supplied search term always matches as a literal
 * substring. Prisma's `contains`/`startsWith` filters do not do this
 * themselves — an unescaped `%` in a search term would mean "match
 * anything", not the literal-contains semantics the admin discovery
 * contract promises.
 */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
