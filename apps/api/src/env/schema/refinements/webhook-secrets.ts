// Populate the synthetic `WEBHOOK_SECRETS` aggregate from dynamic
// `WEBHOOK_<PROVIDER>_SECRET` env vars before the object schema validates.
export function collectWebhookSecrets(config: Record<string, unknown>): Record<string, string> {
  return Object.entries(config).reduce<Record<string, string>>((acc, [key, value]) => {
    const match = /^WEBHOOK_([A-Z0-9_]+)_SECRET$/.exec(key)
    if (!match || typeof value !== 'string' || value.trim() === '') return acc
    acc[match[1]!.toLowerCase()] = value
    return acc
  }, {})
}

// Preprocess step: inject the aggregate so the object schema can validate it.
export function injectWebhookSecrets(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  return { ...raw, WEBHOOK_SECRETS: collectWebhookSecrets(raw as Record<string, unknown>) }
}
