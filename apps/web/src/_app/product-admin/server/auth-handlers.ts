import {
  forgotPasswordSchema,
  loginSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@amcore/shared'

import { handleBrowserBootstrap } from '@/shared/api/bff/browser-bootstrap-handler'
import { handleCredentialAuth } from '@/shared/api/bff/credential-auth-handler'
import { handleLogout } from '@/shared/api/bff/logout-handler'
import {
  proxyOAuthAuthorize,
  proxyOAuthCallback,
  proxyOAuthLink,
} from '@/shared/api/bff/oauth-provider-proxy'
import { productWebRoute } from '@/shared/api/bff/product-web-route'
import { handlePublicAuthAction } from '@/shared/api/bff/public-auth-action'

import 'server-only'

export const productAdminAuthHandlers = {
  browserContext: (request: Request) =>
    productWebRoute(request, 'admin-auth', (context) => handleBrowserBootstrap(request, context)),
  link: (request: Request, provider: string) =>
    productWebRoute(request, 'admin-auth', (context) => proxyOAuthLink(request, provider, context)),
  authorize: (request: Request, provider: string) =>
    productWebRoute(request, 'admin-auth', (context) =>
      proxyOAuthAuthorize(request, provider, context)
    ),
  callback: (request: Request, provider: string) =>
    productWebRoute(
      request,
      'admin-auth',
      (context) => proxyOAuthCallback(request, provider, context),
      true
    ),
  login: (request: Request) =>
    productWebRoute(request, 'admin-auth', (context) =>
      handleCredentialAuth(request, {
        context,
        schema: loginSchema,
        backendPath: '/auth/login',
        successStatus: 200,
      })
    ),
  logout: (request: Request) =>
    productWebRoute(request, 'admin-auth', (context) => handleLogout(request, context)),
  forgotPassword: (request: Request) =>
    productWebRoute(request, 'admin-auth', (context) =>
      handlePublicAuthAction(request, {
        context,
        schema: forgotPasswordSchema,
        backendPath: '/auth/forgot-password',
      })
    ),
  resetPassword: (request: Request) =>
    productWebRoute(request, 'admin-auth', (context) =>
      handlePublicAuthAction(request, {
        context,
        schema: resetPasswordSchema,
        backendPath: '/auth/reset-password',
      })
    ),
  verifyEmail: (request: Request) =>
    productWebRoute(request, 'admin-auth', (context) =>
      handlePublicAuthAction(request, {
        context,
        schema: verifyEmailSchema,
        backendPath: '/auth/verify-email',
      })
    ),
  resendVerification: (request: Request) =>
    productWebRoute(request, 'admin-auth', (context) =>
      handlePublicAuthAction(request, {
        context,
        schema: resendVerificationSchema,
        backendPath: '/auth/resend-verification',
      })
    ),
}
