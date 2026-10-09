import { z } from 'zod'

/** Version 1 mirrors the installed Resend serializer's field order and omitted fields. */
export const preparedEmailBodySchema = z
  .object({
    from: z.string().min(1),
    html: z.string(),
    reply_to: z.string().optional(),
    subject: z.string(),
    text: z.string(),
    to: z.array(z.string().min(1)).length(1),
  })
  .strict()

export function serializeNotificationEmail(input: {
  from: string
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
}): string {
  return JSON.stringify({
    from: input.from,
    html: input.html,
    reply_to: input.replyTo,
    subject: input.subject,
    text: input.text,
    to: [input.to],
  })
}
