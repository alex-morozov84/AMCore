import type { ComponentProps } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

function Pagination({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex items-center gap-0.5', className)}
      {...props}
    />
  )
}

function PaginationItem(props: ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

type LinkProps = ComponentProps<typeof RouteProgressLink> & {
  isActive?: boolean
}

function PaginationLink({ className, isActive, ...props }: LinkProps) {
  return (
    <RouteProgressLink
      data-slot="pagination-link"
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        buttonVariants({ variant: isActive ? 'outline' : 'ghost', size: 'default' }),
        className
      )}
      {...props}
    />
  )
}

type DirectionProps = Omit<LinkProps, 'children'> & { label: string }

function PaginationPrevious({ className, label, ...props }: DirectionProps) {
  return (
    <PaginationLink aria-label={label} className={cn('pl-1.5!', className)} {...props}>
      <ChevronLeft aria-hidden data-icon="inline-start" />
      <span>{label}</span>
    </PaginationLink>
  )
}

function PaginationNext({ className, label, ...props }: DirectionProps) {
  return (
    <PaginationLink aria-label={label} className={cn('pr-1.5!', className)} {...props}>
      <span>{label}</span>
      <ChevronRight aria-hidden data-icon="inline-end" />
    </PaginationLink>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
