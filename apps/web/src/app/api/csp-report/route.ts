import { handleCspReport } from '@/shared/lib/csp/csp-report-handler'

export async function POST(request: Request) {
  return handleCspReport(request)
}
