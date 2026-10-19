import { ownApiKeyHandlers, ownApiKeyMethodDenied } from '@/_app/organization-access/index.server'

export const GET = ownApiKeyHandlers.session
export const POST = () => ownApiKeyMethodDenied('GET')
export const PUT = () => ownApiKeyMethodDenied('GET')
export const PATCH = () => ownApiKeyMethodDenied('GET')
export const DELETE = () => ownApiKeyMethodDenied('GET')
export const HEAD = () => ownApiKeyMethodDenied('GET')
export const OPTIONS = () => ownApiKeyMethodDenied('GET')
