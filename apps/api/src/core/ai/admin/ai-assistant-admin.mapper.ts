import type { AiAssistant } from '@prisma/client'

import type { AiAssistantResponse, AiModelSelection } from '@amcore/shared'

/**
 * DB → wire projection for the assistant-admin surface (Track C — ADR-054, Arc F.1). `modelSelection`
 * is stored as validated JSON (the shared `aiModelSelectionSchema` shape) and re-validated by the
 * `@ZodResponse` interceptor on the way out, so the cast is safe. `systemPrompt` is trusted
 * instruction text, exposed to SUPER_ADMIN only through this admin surface — never logged or audited.
 */
export function toAiAssistantResponse(assistant: AiAssistant): AiAssistantResponse {
  return {
    id: assistant.id,
    slug: assistant.slug,
    version: assistant.version,
    displayName: assistant.displayName,
    enabled: assistant.enabled,
    systemPrompt: assistant.systemPrompt,
    modelSelection: assistant.modelSelection as unknown as AiModelSelection,
    allowedModalities: assistant.allowedModalities as AiAssistantResponse['allowedModalities'],
    toolAllowlist: assistant.toolAllowlist,
    budgetClass: assistant.budgetClass,
    createdAt: assistant.createdAt.toISOString(),
    updatedAt: assistant.updatedAt.toISOString(),
  }
}
