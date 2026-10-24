import { scryptSync } from 'node:crypto'

/**
 * Which settings an observation belongs to: the bot token, the normalized API base URL and the
 * version of this check. Workers store it with each result and the Console reader keeps only the
 * results whose binding equals its own, so an old success never vouches for new settings. A
 * deliberately slow derivation keeps a leaked binding useless for guessing the token; the last
 * value is remembered so a repeated read costs nothing.
 */
let last: { input: string; value: string } | undefined

export function telegramCheckBinding(token: string, baseUrl: string): string {
  const input = `${token}\n${baseUrl.replace(/\/+$/, '')}\ngetme-v1`
  if (last?.input !== input) {
    const value = scryptSync(input, 'amcore.integrations.telegram-check.v1', 32, { N: 16_384 })
    last = { input, value: value.toString('hex') }
  }
  return last.value
}
