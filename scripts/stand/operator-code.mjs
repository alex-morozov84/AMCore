import { loadFactor, totp } from './operator-totp.mjs'
import { DEMO_EMAILS } from './demo-credentials.mjs'

/** `pnpm stand code --id <id>`: the operator's current sign-in code. The secret itself is never printed. */
export async function printOperatorCode(m) {
  if (!m.operatorMfa)
    throw new Error(
      'This stand has no operator MFA. Create a fresh preview stand with the Console enabled in path mode.'
    )
  const factor = await loadFactor(m)
  if (!factor)
    throw new Error('The operator is not enrolled yet. Run: pnpm stand preview --id <id>')
  const { code, secondsLeft } = totp(factor.secret)
  console.log(
    `Operator ${DEMO_EMAILS.SUPER_ADMIN}: code ${code} (valid for about ${secondsLeft} s)`
  )
}
