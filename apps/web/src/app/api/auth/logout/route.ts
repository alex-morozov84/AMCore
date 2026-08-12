import { handleLogout } from '@/shared/api/bff/logout-handler'

export async function POST(request: Request): Promise<Response> {
  return handleLogout(request)
}
