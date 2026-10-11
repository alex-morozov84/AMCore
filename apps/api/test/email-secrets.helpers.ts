import type { EmailService } from '../src/infrastructure/email/email.service'

export async function waitForEmailCondition(
  check: () => Promise<boolean>,
  label: string
): Promise<void> {
  const deadline = performance.now() + 5000
  while (!(await check())) {
    if (performance.now() >= deadline) throw new Error(`Email observation timeout: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

interface DirectEmailObserver {
  operation: (template: string, to: string, trigger: () => Promise<unknown>) => Promise<unknown>
  reset: () => Promise<void>
  restore: () => void
}

/** Call through the real sender; track fulfillment for the exact template/recipient/call. */
export function observeDirectEmails(service: EmailService): DirectEmailObserver {
  const original = service.sendNow.bind(service)
  const calls: { template: string; to: string; done: boolean; failed: boolean }[] = []
  service.sendNow = async (...args: Parameters<EmailService['sendNow']>) => {
    const call = { template: args[0], to: args[1], done: false, failed: false }
    calls.push(call)
    try {
      await original(...args)
    } catch (error) {
      call.failed = true
      throw error
    } finally {
      call.done = true
    }
  }
  return {
    async operation(template: string, to: string, trigger: () => Promise<unknown>) {
      const offset = calls.length
      const result = await trigger()
      await waitForEmailCondition(
        async () =>
          calls
            .slice(offset)
            .some((call) => call.template === template && call.to === to && call.done),
        `${template} call completion`
      )
      if (
        calls
          .slice(offset)
          .some((call) => call.template === template && call.to === to && call.failed)
      ) {
        throw new Error(`Direct email rejected: ${template}`)
      }
      return result
    },
    async reset() {
      await waitForEmailCondition(
        async () => calls.every((call) => call.done),
        'pending direct sends'
      )
      calls.length = 0
    },
    restore() {
      service.sendNow = original
    },
  }
}

export function queuedTemplate(data: unknown): string {
  const envelope = data as { protocolVersion?: unknown; payload?: { template?: unknown } }
  if (envelope?.protocolVersion !== 1 || typeof envelope.payload?.template !== 'string') {
    throw new Error('Invalid managed email envelope')
  }
  return envelope.payload.template
}
