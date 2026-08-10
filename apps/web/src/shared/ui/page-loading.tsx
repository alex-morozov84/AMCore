import { Spinner } from '@/shared/ui/spinner'

function PageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  )
}

export { PageLoading }
