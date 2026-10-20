import { handleOAuthCompletion } from '@/shared/api/bff/oauth-completion-handler'

export const POST = (request: Request) => handleOAuthCompletion(request, 'admin-auth')
