import { ownApiKeyHandlers, ownApiKeyMethodDenied } from '@/_app/organization-access/index.server'

export const GET = () => ownApiKeyMethodDenied('DELETE')
export const POST = () => ownApiKeyMethodDenied('DELETE')
export const PUT = () => ownApiKeyMethodDenied('DELETE')
export const PATCH = () => ownApiKeyMethodDenied('DELETE')
export const DELETE = async (request: Request, context: { params: Promise<{ id: string }> }) =>
  ownApiKeyHandlers.revoke(request, (await context.params).id)
export const HEAD = () => ownApiKeyMethodDenied('DELETE')
export const OPTIONS = () => ownApiKeyMethodDenied('DELETE')
