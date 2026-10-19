import { ownApiKeyHandlers, ownApiKeyMethodDenied } from '@/_app/organization-access/index.server'

export const GET = ownApiKeyHandlers.list
export const POST = ownApiKeyHandlers.create
export const PUT = () => ownApiKeyMethodDenied('GET, POST')
export const PATCH = () => ownApiKeyMethodDenied('GET, POST')
export const DELETE = () => ownApiKeyMethodDenied('GET, POST')
export const HEAD = () => ownApiKeyMethodDenied('GET, POST')
export const OPTIONS = () => ownApiKeyMethodDenied('GET, POST')
