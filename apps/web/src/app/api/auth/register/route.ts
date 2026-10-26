import { registerSchema } from '@amcore/shared'

import { handleCredentialAuth } from '@/shared/api/bff/credential-auth-handler'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

export async function POST(request: Request) {
  return productWebRoute(request, 'site-auth', (context) =>
    handleCredentialAuth(request, {
      context,
      schema: registerSchema,
      backendPath: '/auth/register',
      successStatus: 201,
      registration: true,
    })
  )
}
