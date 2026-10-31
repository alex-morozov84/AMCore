// Only explicitly admitted binary defects may become mandatory descriptor rules.
// Performance/timing/image-delivery opportunities remain informational.
export const requiredAuditCategories = Object.freeze({
  label: 'accessibility',
  'button-name': 'accessibility',
  'image-alt': 'accessibility',
  'is-on-https': 'best-practices',
})

export function assertRequiredAudits(ids) {
  if (
    !Array.isArray(ids) ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || !Object.hasOwn(requiredAuditCategories, id))
  )
    throw new Error('unsupported-required-audits')
}
