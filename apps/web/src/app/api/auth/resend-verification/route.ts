import { resendVerificationSchema } from '@amcore/shared'

import { productWebRoute } from '@/shared/api/bff/product-web-route'
import { handlePublicAuthAction } from '@/shared/api/bff/public-auth-action'

export async function POST(request: Request) {
  return productWebRoute(request, 'site-auth', (context) =>
    handlePublicAuthAction(request, {
      context,
      schema: resendVerificationSchema,
      backendPath: '/auth/resend-verification',
    })
  )
}
