import { z } from 'zod'

/**
 * Apple sends a custom `user` form field ONLY on the first authorization
 * (Sign in with Apple, `response_mode=form_post`). It is a JSON string shaped
 * `{"name":{"firstName":"..","lastName":".."},"email":".."}`. The display name
 * never appears in the ID token or userinfo, so the first login is the single
 * opportunity to capture it.
 *
 * Parse defensively: an absent or malformed `user` field is the normal case on
 * every subsequent login and must never break the callback — return `null` and
 * let the account keep whatever name it already has.
 */
const appleUserSchema = z.object({
  name: z
    .object({
      firstName: z.string().trim().optional(),
      lastName: z.string().trim().optional(),
    })
    .optional(),
})

export function parseAppleUserName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = appleUserSchema.safeParse(parsed)
  if (!result.success) return null

  const name = result.data.name
  const full = [name?.firstName, name?.lastName].filter(Boolean).join(' ').trim()
  return full.length > 0 ? full : null
}
