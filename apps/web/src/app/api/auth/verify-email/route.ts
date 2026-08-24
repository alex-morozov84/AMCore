import { verifyEmailSchema } from '@amcore/shared'

import { handlePublicAuthAction } from '@/shared/api/bff/public-auth-action'

export async function POST(request: Request) {
  return handlePublicAuthAction(request, {
    schema: verifyEmailSchema,
    backendPath: '/auth/verify-email',
  })
}
