import { ConsoleAccountSecurityMount } from '@/_app/console-account-security'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'

export default function AccountSecurity() {
  requireConsoleEnabled()
  return <ConsoleAccountSecurityMount />
}
