import { loginSchema } from '@amcore/shared'

import { handleCredentialAuth } from '@/shared/api/bff/credential-auth-handler'

export async function POST(request: Request) {
  return handleCredentialAuth(request, {
    schema: loginSchema,
    backendPath: '/auth/login',
    successStatus: 200,
  })
}
