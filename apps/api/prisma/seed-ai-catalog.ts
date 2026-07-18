/* eslint-disable no-console */
import { Prisma, type PrismaClient } from '../src/generated/prisma/client'

import { AI_CATALOG_SEED } from './seed-ai-catalog.data'

/**
 * Seed the AI capability-layer catalog (Track C — ADR-054, Arc A). **Convergent** upsert by
 * slug: re-running applies the declared non-secret defaults (display name, enabled, model
 * name, capabilities, limits, credential slot, config), so the seed is the canonical catalog
 * shape and does not drift as Arc B evolves defaults. The data lives in `seed-ai-catalog.data.ts`.
 */
export async function seedAiCatalog(prisma: PrismaClient): Promise<void> {
  for (const provider of AI_CATALOG_SEED) {
    const providerData = {
      type: provider.type,
      displayName: provider.displayName,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl ?? null,
      credentialSlot: provider.credentialSlot ?? null,
      config: (provider.config ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    }
    const row = await prisma.aiProvider.upsert({
      where: { slug: provider.slug },
      update: providerData,
      create: { slug: provider.slug, ...providerData },
    })

    for (const model of provider.models) {
      const modelData = {
        providerId: row.id,
        providerModelName: model.providerModelName,
        displayName: model.displayName,
        enabled: model.enabled,
        isDefault: model.isDefault,
        capabilities: model.capabilities,
        contextLimit: model.contextLimit ?? null,
        maxOutputTokens: model.maxOutputTokens ?? null,
      }
      await prisma.aiModel.upsert({
        where: { slug: model.slug },
        update: modelData,
        create: { slug: model.slug, ...modelData },
      })
    }
  }

  console.log(
    `Seeded AI catalog: ${AI_CATALOG_SEED.length} providers (mock + Claude default + examples)`
  )
}
