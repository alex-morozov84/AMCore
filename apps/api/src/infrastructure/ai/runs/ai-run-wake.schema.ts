import { z } from 'zod'

/**
 * `AI_RUN_WAKE` wake-job payload (Track C — ADR-054, ADR-052 pattern). A wake is a hint only — the
 * dispatcher drains ALL due runs via `FOR UPDATE SKIP LOCKED`, not just this id — so the payload
 * carries no prompt, no destination, and no secret: only the optional originating run id for
 * observability. Runtime-validated by the processor because BullMQ job data is untrusted Redis JSON;
 * an invalid payload still drains (the drain is independent of it).
 */
export const aiRunWakeJobSchema = z.object({
  runId: z.string().optional(),
})

export type AiRunWakeJob = z.infer<typeof aiRunWakeJobSchema>
