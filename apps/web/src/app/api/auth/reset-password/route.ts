import { resetPasswordSchema } from '@amcore/shared'

import { handlePublicAuthAction } from '@/shared/api/bff/public-auth-action'

export async function POST(request: Request) {
  return handlePublicAuthAction(request, {
    schema: resetPasswordSchema,
    backendPath: '/auth/reset-password',
  })
}
