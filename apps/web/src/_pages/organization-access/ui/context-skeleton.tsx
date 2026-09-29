import { Card, CardContent, CardFooter, CardHeader } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

export function OrganizationAccessSkeleton({ selected }: { selected: boolean }) {
  return (
    <div aria-hidden="true" className="grid gap-4 md:grid-cols-2">
      {[0, 1].map((key) => (
        <Card key={key}>
          <CardHeader>
            <Skeleton className="h-5 w-40 motion-reduce:animate-none" />
            {!selected && <Skeleton className="h-4 w-28 motion-reduce:animate-none" />}
          </CardHeader>
          {selected ? (
            <CardContent className="space-y-4">
              <Skeleton className="h-5 w-3/4 motion-reduce:animate-none" />
              <Skeleton className="h-16 w-full motion-reduce:animate-none" />
              <Skeleton className="h-10 w-full motion-reduce:animate-none" />
            </CardContent>
          ) : (
            <CardFooter>
              <Skeleton className="h-8 w-20 motion-reduce:animate-none" />
            </CardFooter>
          )}
        </Card>
      ))}
    </div>
  )
}
