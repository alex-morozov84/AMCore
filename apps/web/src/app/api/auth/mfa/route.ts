import { accountMfaRoute } from '@/_app/account-security'

export const GET = (request: Request) => accountMfaRoute(request, 'site')
export const POST = GET
