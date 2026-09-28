import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function previewLabels(m) {
  const messages = JSON.parse(
    await readFile(join(m.snapshot, `apps/web/messages/${m.baseLocale}.json`), 'utf8')
  )
  const labels = {
    product: {
      email: messages.auth.email,
      password: messages.auth.password,
      submit: messages.auth.login,
    },
  }
  // AMCORE_CONSOLE_PREVIEW_LABELS_START
  if (m.consoleEnabled)
    labels.console = {
      email: messages.console.loginEmail,
      password: messages.console.loginPassword,
      submit: messages.console.signIn,
    }
  // AMCORE_CONSOLE_PREVIEW_LABELS_END
  return labels
}
