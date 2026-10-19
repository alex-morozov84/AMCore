import type { ReactNode } from 'react'

/**
 * A link that opens another site in a new tab. The browser gets no opener and sends no referrer, and
 * the sr-only label tells everyone, not only those who can see an icon, that the tab will change. The
 * caller supplies the already translated label.
 */
export function NewTabLink({
  href,
  newTabLabel,
  className,
  onClick,
  children,
}: {
  href: string
  newTabLabel: string
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={onClick}
    >
      {children}
      <span className="sr-only"> {newTabLabel}</span>
    </a>
  )
}
