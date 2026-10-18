import Image from 'next/image'
import { User } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

interface UserAvatarProps {
  name?: string | null
  avatarUrl?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /**
   * The name is shown next to the avatar, so the avatar adds nothing to it. The initials are then
   * drawn with CSS instead of text, which keeps a control's visible text equal to the name alone
   * (WCAG 2.5.3 "Label in Name"), and the image gets an empty alt.
   */
  decorative?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
  xl: 'size-20 text-xl',
}

const sizePx = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 80,
}

const iconSizes = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-10',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function UserAvatar({
  name,
  avatarUrl,
  size = 'md',
  decorative = false,
  className,
}: UserAvatarProps) {
  const baseClasses =
    'flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground'

  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={decorative ? '' : name || 'User avatar'}
        width={sizePx[size]}
        height={sizePx[size]}
        // Served as stored: derivatives are already sized WebP files, so the Next.js image optimizer
        // (a server-side fetch of a remote URL) is not needed and no remote host list is required.
        unoptimized
        className={cn(baseClasses, sizeClasses[size], 'object-cover', className)}
      />
    )
  }

  if (name && decorative) {
    return (
      <div
        aria-hidden
        data-initials={getInitials(name)}
        className={cn(
          baseClasses,
          sizeClasses[size],
          'before:content-[attr(data-initials)]',
          className
        )}
      />
    )
  }

  if (name) {
    return <div className={cn(baseClasses, sizeClasses[size], className)}>{getInitials(name)}</div>
  }

  return (
    <div className={cn(baseClasses, sizeClasses[size], className)}>
      <User className={iconSizes[size]} />
    </div>
  )
}
