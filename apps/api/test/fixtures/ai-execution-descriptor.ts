import type { AiExecutionDescriptor } from '../../src/infrastructure/ai/registry/ai-execution-descriptor'

export function executionDescriptor(
  overrides: Partial<AiExecutionDescriptor> = {}
): AiExecutionDescriptor {
  return {
    version: 1,
    modelId: 'model-fixture',
    providerId: 'provider-fixture',
    modelSlug: 'claude-default',
    providerSlug: 'anthropic',
    providerType: 'ANTHROPIC',
    providerModelName: 'claude',
    capabilities: { text: true },
    contextLimit: null,
    maxOutputTokens: null,
    credentialSlot: 'default',
    endpoint: { kind: 'built_in' },
    ...overrides,
  }
}
