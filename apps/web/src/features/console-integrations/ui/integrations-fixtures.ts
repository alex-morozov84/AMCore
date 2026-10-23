import type {
  IntegrationAction,
  IntegrationEvidence,
  IntegrationItem,
  IntegrationsResponse,
} from '@amcore/shared'

export const READ_AT = '2026-10-22T12:00:00.000Z'

export const NONE: IntegrationEvidence = {
  result: 'none',
  freshness: 'none',
  scope: 'configuration_only',
  instance: 'answering_instance',
  checkedAt: null,
  staleAfterSeconds: null,
  failure: null,
}

export const emailAction: IntegrationAction = {
  probeId: 'email_test',
  kind: 'operator_email_test',
  available: true,
  unavailableReason: null,
  cooldownRemainingSeconds: 0,
  ownAttemptId: null,
}

export function item(over: Partial<IntegrationItem> = {}): IntegrationItem {
  return {
    id: 'email',
    name: 'Email',
    configuration: 'configured',
    source: 'ok',
    evidence: {
      ...NONE,
      scope: 'provider_acceptance',
      instance: 'shared',
      staleAfterSeconds: 86400,
    },
    facts: [
      { key: 'provider', value: 'resend' },
      { key: 'sender_domain', value: 'example.com' },
    ],
    links: [],
    action: emailAction,
    ...over,
  }
}

export const storageFailedStale = item({
  id: 'storage',
  name: 'Files',
  action: null,
  links: ['overview'],
  facts: [{ key: 'driver', value: 's3' }],
  evidence: {
    result: 'failed',
    freshness: 'stale',
    scope: 'private_file_write_read_delete',
    instance: 'answering_instance',
    checkedAt: '2026-10-22T11:00:00.000Z',
    staleAfterSeconds: 1800,
    failure: 'access_denied',
  },
})

export const oauthConfigOnly = item({
  id: 'oauth',
  name: 'Sign-in providers',
  evidence: NONE,
  action: null,
  facts: [
    { key: 'providers_count', value: 2 },
    { key: 'providers', value: 'github, google' },
  ],
})

export const unreadable = item({
  id: 'queue',
  name: 'Queue',
  action: null,
  source: 'unavailable',
  configuration: 'not_configured',
  facts: [],
  evidence: { ...NONE, scope: 'broker_read' },
})

/** A downstream integration with no message keys of its own: it must still render. */
export const custom = item({
  id: 'crm_sync',
  name: 'CRM sync',
  evidence: NONE,
  action: null,
  facts: [{ key: 'open_tickets', value: 4 }],
})

export function response(items: IntegrationItem[]): IntegrationsResponse {
  return { readAt: READ_AT, items }
}
