import { z } from 'zod'

/** Plain, code-owned significant action data; never arbitrary HTML, URLs or raw arguments. */
const plainText = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (value) =>
      !/[<>]/.test(value) &&
      !Array.from(value).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) &&
      !/https?:\/\//i.test(value)
  )

export const aiApprovalPreviewSchema = z
  .object({
    title: plainText,
    summary: plainText,
    target: z.object({ id: z.string().min(1).max(255), label: plainText }).strict(),
    effects: z.array(plainText).min(1).max(10),
  })
  .strict()
export type AiApprovalPreview = z.infer<typeof aiApprovalPreviewSchema>
export const aiIntentHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
