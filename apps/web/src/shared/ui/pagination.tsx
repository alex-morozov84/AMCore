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

type ButtonDirectionProps = ComponentProps<'button'> & { label: string }

/** Same visual treatment as `PaginationLink`, for callers paging local state instead of a `href`. */
function PaginationButton({
  className,
  isActive,
  ...props
}: ComponentProps<'button'> & { isActive?: boolean }) {
  return (
    <button
      type="button"
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

function PaginationPreviousButton({ className, label, ...props }: ButtonDirectionProps) {
  return (
    <PaginationButton aria-label={label} className={cn('pl-1.5!', className)} {...props}>
      <ChevronLeft aria-hidden data-icon="inline-start" />
      <span>{label}</span>
    </PaginationButton>
  )
}

function PaginationNextButton({ className, label, ...props }: ButtonDirectionProps) {
  return (
    <PaginationButton aria-label={label} className={cn('pr-1.5!', className)} {...props}>
      <span>{label}</span>
      <ChevronRight aria-hidden data-icon="inline-end" />
    </PaginationButton>
  )
}

type PaginationButtonsProps = {
  page: number
  onPageChange: (page: number) => void
  previousLabel: string
  nextLabel: string
  pageLabel?: string
  /** Disables both directions while a page request is in flight. */
  isFetching?: boolean
} & (
  | {
      pageSize: number
      total: number
      hasPreviousPage?: never
      hasNextPage?: never
    }
  | {
      pageSize?: never
      total?: never
      hasPreviousPage: boolean
      hasNextPage: boolean
    }
)

/** Local-state pager: known totals or explicit directions for a bounded live window. */
function PaginationButtons(props: PaginationButtonsProps) {
  const { page, onPageChange, previousLabel, nextLabel, pageLabel, isFetching } = props
  const knownTotal = props.total !== undefined
  if (knownTotal && props.total <= props.pageSize) return null
  const hasPreviousPage = knownTotal ? page > 1 : props.hasPreviousPage
  const hasNextPage = knownTotal ? page * props.pageSize < props.total : props.hasNextPage

  if (!hasPreviousPage && !hasNextPage) return null

  return (
    <Pagination aria-label={`${previousLabel} / ${nextLabel}`} className="justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPreviousButton
            label={previousLabel}
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPreviousPage || isFetching}
          />
        </PaginationItem>
        {pageLabel && (
          <PaginationItem>
            <span aria-current="page">{pageLabel}</span>
          </PaginationItem>
        )}
        <PaginationItem>
          <PaginationNextButton
            label={nextLabel}
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNextPage || isFetching}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

export {
  Pagination,
  PaginationButtons,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationNextButton,
  PaginationPrevious,
  PaginationPreviousButton,
}
