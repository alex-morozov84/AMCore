import Image from 'next/image';
import { User } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

interface UserAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
};

const sizePx = {
  sm: 32,
  md: 40,
  lg: 48,
};

const iconSizes = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function UserAvatar({ name, avatarUrl, size = 'md', className }: UserAvatarProps) {
  const baseClasses =
    'flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground';

  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name || 'User avatar'}
        width={sizePx[size]}
        height={sizePx[size]}
        className={cn(baseClasses, sizeClasses[size], 'object-cover', className)}
      />
    );
  }

  if (name) {
    return <div className={cn(baseClasses, sizeClasses[size], className)}>{getInitials(name)}</div>;
  }

  return (
    <div className={cn(baseClasses, sizeClasses[size], className)}>
      <User className={iconSizes[size]} />
    </div>
  );
}
