import { accountMfaRoute } from '@/_app/account-security'

export const GET = (request: Request) => accountMfaRoute(request, 'admin')
export const POST = GET
