import type { ComponentProps } from 'react'
import { ChevronDownIcon } from 'lucide-react'

/** A shared disclosure treatment; labels and controlled state belong to the screen. */
export function ConsoleFilterDisclosure({
  label,
  children,
  ...props
}: ComponentProps<'details'> & { label: string }) {
  return (
    <details {...props} className="group rounded-lg border border-border p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  )
}
