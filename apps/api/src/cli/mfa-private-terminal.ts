import { fstatSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

/** A pipe, different device, shared readable terminal or another OS owner's terminal is refused. */
export function requirePrivateMfaTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.geteuid)
    throw new Error('private_terminal_required')
  const input = fstatSync(0)
  const output = fstatSync(1)
  const owner = process.geteuid()
  if (
    !input.isCharacterDevice() ||
    !output.isCharacterDevice() ||
    input.uid !== owner ||
    output.uid !== owner ||
    input.rdev !== output.rdev ||
    input.dev !== output.dev ||
    input.ino !== output.ino ||
    (input.mode & 0o044) !== 0 ||
    (output.mode & 0o044) !== 0
  )
    throw new Error('private_terminal_required')
}

export async function confirmOfflineMfaReset(
  userId: string
): Promise<{ reason: string; confirmation: string }> {
  requirePrivateMfaTerminal()
  const reader = createInterface({ input: process.stdin, output: process.stdout })
  try {
    process.stdout.write(
      'This removes the authenticator and backup codes and signs out every session.\n'
    )
    process.stdout.write(
      'The enrollment ticket will be shown once in this private terminal. Do not record this session.\n'
    )
    const reason = await reader.question('Reason (no passwords, keys or personal details): ')
    const confirmation = await reader.question(`Type RESET ${userId} to confirm: `)
    requirePrivateMfaTerminal()
    return { reason, confirmation }
  } finally {
    reader.close()
  }
}

/** Never route a ticket through console, JSON output or the application logger. */
export function displayOfflineMfaTicket(ticket: string, expiresAt: Date): void {
  requirePrivateMfaTerminal()
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('invalid_ticket')
  const text = Buffer.from(
    `\nENROLLMENT TICKET: ${ticket}\nExpires: ${expiresAt.toISOString()}\nDeliver it privately. A lost ticket requires a new confirmed reset.\n`
  )
  let offset = 0
  while (offset < text.length) {
    const written = writeSync(1, text, offset, text.length - offset)
    if (written <= 0) throw new Error('terminal_write_failed')
    offset += written
  }
}
