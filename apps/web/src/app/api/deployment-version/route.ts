import { DEPLOYMENT_VERSION } from '@/shared/lib/deployment-version/identity'

export function GET() {
  return Response.json(
    { version: DEPLOYMENT_VERSION },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'CDN-Cache-Control': 'no-store',
        'Surrogate-Control': 'no-store',
      },
    }
  )
}
