/**
 * Redacts an email address for logs/durable snapshots (no full address at
 * rest or in a rotated log line): keeps the first local-part character and the
 * domain — `a***@example.com`. The domain survives because bounce/delivery
 * triage is overwhelmingly domain-level; the exact address remains available
 * in the BullMQ job record for its retention window when actually needed.
 */
export function redactEmail(email: string): string
export function redactEmail(email: string | undefined): string | undefined
export function redactEmail(email: string | undefined): string | undefined {
  if (email === undefined) return undefined
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}
