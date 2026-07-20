import { z } from 'zod'

import { optionalEnvString } from './helpers'

// AI capability layer (Track C — ADR-054). The provider/model catalog is DB-backed
// (admin-managed); only the SECRETS live in env. A catalog row's `credentialSlot`
// is mapped to one of these fixed keys through a code-owned per-type allowlist
// (`credential-resolver.ts`) — a slot value NEVER indexes `process.env` directly.
// An enabled provider with no key is gated out at runtime (the gateway falls back
// to the key-less `mock` provider), so these stay optional with no refinement force.
export const aiEnv = z.object({
  ANTHROPIC_API_KEY: optionalEnvString(),
  OPENAI_API_KEY: optionalEnvString(),
  OPENROUTER_API_KEY: optionalEnvString(),
  YANDEX_API_KEY: optionalEnvString(),
  AI_OPENAI_COMPATIBLE_API_KEY: optionalEnvString(),
  // Per-request gateway bound (ms) applied to every provider call. Capped at 5 min so a
  // typo can't allow day-long calls (a long generation streams within this bound).
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).max(300000).default(60000),
  // Bounded Redis TTL for the catalog snapshot cache (seconds). Capped at 1h so an admin
  // catalog change can never stay stale longer than that even on a typo.
  AI_CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  // Arc D input guardrail enforcement mode. `off` disables the heuristic input scan; `flag`
  // (default) records/counts findings but never blocks; `block` hard-blocks only AMCore
  // envelope/marker abuse. The structural trust boundary + output guard run regardless.
  AI_GUARDRAIL_INPUT_MODE: z.enum(['off', 'flag', 'block']).default('flag'),
  // Max characters of untrusted user text before a run is refused (guardrail_input_too_large).
  // Always enforced (independent of the input mode). Bounded so a typo can't disable the cap.
  AI_GUARDRAIL_MAX_INPUT_CHARS: z.coerce.number().int().min(1).max(1_000_000).default(100000),
  // Arc E bounded agent loop: max provider steps per run before tool_loop_exhausted. Bounded so
  // a runaway loop can never burn unlimited provider calls; total wall-clock is also capped by
  // the run deadline.
  AI_TOOL_LOOP_MAX_STEPS: z.coerce.number().int().min(1).max(50).default(8),
  // Arc E per-tool host-side execution bound (ms). Capped so a stuck tool cannot hold a loop
  // step open indefinitely.
  AI_TOOL_EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1).max(120000).default(15000),
  // Arc E human-in-the-loop approval TTL (ms): how long a run may sit parked in WAITING_APPROVAL
  // before the approval expires. Default 24h; bounded [1min, 30d] so a typo can neither expire a
  // pending approval instantly nor park a run indefinitely. A run's own deadline still wins if it
  // is tighter (the park stores min(now+TTL, deadlineAt)).
  AI_APPROVAL_TTL_MS: z.coerce.number().int().min(60_000).max(2_592_000_000).default(86_400_000),
  // Arc G artifact upload size ceilings (raw bytes, before base64 encoding). Defaults match the
  // existing IMAGE_VALIDATION/DOCUMENT_VALIDATION presets; bounded so a typo can neither starve
  // real uploads nor exceed verified provider per-request payload limits (Anthropic: 10 MB
  // base64/image, ~32 MB total request).
  AI_ARTIFACT_MAX_IMAGE_BYTES: z.coerce.number().int().min(1).max(20_971_520).default(5_242_880),
  AI_ARTIFACT_MAX_DOCUMENT_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(33_554_432)
    .default(10_485_760),
  // Max artifact_ref parts one run's inputParts may carry. Tighter than the generic
  // AI_MESSAGE_MAX_PARTS (64, sized for text-only turns) — a handful of multi-MB binary parts is
  // already a meaningful payload. Bounded so a typo can't allow an unbounded per-request fan-out.
  AI_ARTIFACT_MAX_PARTS_PER_MESSAGE: z.coerce.number().int().min(1).max(20).default(4),
})
