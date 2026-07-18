import type { ResolvedAiModel } from '../registry/ai-registry.types'

import type { AiGenerateMessage } from './ai-gateway.types'
import { findUnsupportedMultimodalCapability } from './multimodal-capability'

import { AiProviderType } from '@/generated/prisma/client'

/**
 * Unit tests for the Arc G central multimodal capability gate (Track C — ADR-054): pure detection
 * logic, independent of `ModelGateway` construction.
 */

function model(capabilities: Record<string, boolean>): ResolvedAiModel {
  return {
    slug: 's',
    providerModelName: 'pm',
    capabilities,
    contextLimit: null,
    maxOutputTokens: null,
    isDefault: false,
    provider: {
      slug: 'p',
      type: AiProviderType.ANTHROPIC,
      baseUrl: null,
      credentialSlot: 'default',
      dataRetentionClass: 'provider_default',
      config: null,
    },
  }
}

describe('findUnsupportedMultimodalCapability', () => {
  it('returns null for a text-only string turn', () => {
    const messages: AiGenerateMessage[] = [{ role: 'user', content: 'hi' }]
    expect(findUnsupportedMultimodalCapability(model({ text: true }), messages)).toBeNull()
  })

  it('returns null for a multimodal turn when the model declares every required capability', () => {
    const messages: AiGenerateMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image', data: Buffer.from('x'), mediaType: 'image/png' },
        ],
      },
    ]
    expect(
      findUnsupportedMultimodalCapability(model({ text: true, vision: true }), messages)
    ).toBeNull()
  })

  it('returns "vision" when an image part is present but the model lacks vision', () => {
    const messages: AiGenerateMessage[] = [
      {
        role: 'user',
        content: [{ type: 'image', data: Buffer.from('x'), mediaType: 'image/png' }],
      },
    ]
    expect(findUnsupportedMultimodalCapability(model({ text: true }), messages)).toBe('vision')
  })

  it('returns "pdf" when a file part is present but the model lacks pdf', () => {
    const messages: AiGenerateMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'file', data: Buffer.from('x'), mediaType: 'application/pdf', filename: 'a.pdf' },
        ],
      },
    ]
    expect(findUnsupportedMultimodalCapability(model({ text: true }), messages)).toBe('pdf')
  })

  it('ignores assistant/tool turns (only user turns carry multimodal parts)', () => {
    const messages: AiGenerateMessage[] = [
      { role: 'assistant', content: 'hello' },
      {
        role: 'tool',
        toolResults: [{ toolCallId: 'c1', toolName: 't', output: 'ok' }],
      },
    ]
    expect(findUnsupportedMultimodalCapability(model({ text: true }), messages)).toBeNull()
  })

  it('reports the first unsupported capability across multiple parts, not just the last', () => {
    const messages: AiGenerateMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', data: Buffer.from('x'), mediaType: 'image/png' },
          { type: 'file', data: Buffer.from('y'), mediaType: 'application/pdf' },
        ],
      },
    ]
    expect(findUnsupportedMultimodalCapability(model({ text: true }), messages)).toBe('vision')
  })
})
