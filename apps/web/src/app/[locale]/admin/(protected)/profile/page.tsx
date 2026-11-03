import { ConsoleProfileMount } from '@/_app/console-profile'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'

export default function ProfilePage() {
  requireConsoleEnabled()
  return <ConsoleProfileMount />
}
