import { proxyToBackend } from '@/shared/api/bff/authenticated-proxy'

interface RouteContext {
  params: Promise<{ path: string[] }>
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params
  return proxyToBackend(request, path)
}

export const GET = handle
export const HEAD = handle
export const OPTIONS = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
