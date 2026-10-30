import { createConsoleReturnEntry } from '@/shared/api/bff/console-return-entry'
import { consolePersonalMutation } from '@/shared/api/console/personal-mutation-route'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export const POST = (request: Request) =>
  withConsoleHostGuard(request, () =>
    consolePersonalMutation(request, (context) => createConsoleReturnEntry(request, context))
  )
