import { Loader2 } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

interface SpinnerProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-8',
}

function Spinner({ className, size = 'md' }: SpinnerProps) {
  return (
    <Loader2
      data-slot="spinner"
      className={cn('animate-spin text-muted-foreground', sizeClasses[size], className)}
    />
  )
}

export { Spinner }
