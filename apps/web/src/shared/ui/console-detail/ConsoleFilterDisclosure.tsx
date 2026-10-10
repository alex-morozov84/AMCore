import type { ComponentProps } from 'react'

import { Disclosure } from '@/shared/ui/disclosure'

/** A shared disclosure treatment; labels and controlled state belong to the screen. */
export function ConsoleFilterDisclosure({
  label,
  children,
  ...props
}: ComponentProps<'details'> & { label: string }) {
  return (
    <Disclosure
      {...props}
      label={label}
      className="rounded-lg border border-border p-4"
      contentClassName="mt-4 space-y-4"
    >
      {children}
    </Disclosure>
  )
}
