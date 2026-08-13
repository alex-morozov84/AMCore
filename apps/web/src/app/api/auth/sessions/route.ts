import { handleDeleteOtherSessions, handleGetSessions } from '@/shared/api/bff/sessions-handler'

export async function GET(request: Request) {
  return handleGetSessions(request)
}

export async function DELETE(request: Request) {
  return handleDeleteOtherSessions(request)
}
