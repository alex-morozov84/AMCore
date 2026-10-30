import { accountMfaRoute } from '@/_app/account-security'

export const POST = (request: Request) => accountMfaRoute(request, 'site', true)
