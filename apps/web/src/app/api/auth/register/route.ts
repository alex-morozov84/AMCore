import { registerSchema } from '@amcore/shared'

import { handleCredentialAuth } from '@/shared/api/bff/credential-auth-handler'

export async function POST(request: Request) {
  return handleCredentialAuth(request, {
    schema: registerSchema,
    backendPath: '/auth/register',
    successStatus: 201,
  })
}
