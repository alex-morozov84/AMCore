import { z } from 'zod'

/**
 * `DISPATCH_DUE` wake-job payload (ADR-052). A wake is a hint only — the dispatcher
 * drains ALL due deliveries via `FOR UPDATE SKIP LOCKED`, not just this id. The
 * payload therefore carries no user payload, no destination, and no secret: only an
 * optional originating notification id for observability. Runtime-validated by the
 * processor because BullMQ job data is untrusted deserialized Redis JSON.
 */
export const dispatchDueJobSchema = z.object({
  notificationId: z.string().optional(),
})

export type DispatchDueJob = z.infer<typeof dispatchDueJobSchema>
