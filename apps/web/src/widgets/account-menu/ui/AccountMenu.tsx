'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { LogOut, UserRound } from 'lucide-react'

import { useCurrentUser, UserAvatar } from '@/entities/user'
import { useLogout } from '@/features/auth-logout'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Skeleton } from '@/shared/ui/skeleton'

import { ProfileDialog } from './ProfileDialog'

/**
 * The signed-in user's menu: avatar and name (email when there is no name) as the trigger, then
 * Profile (opens the profile dialog) and Log out. It is a ready block with no knowledge of the
 * shell: the application places it, a downstream can move, restyle or replace it.
 */
export function AccountMenu() {
  const t = useTranslations('account')
  const tAuth = useTranslations('auth')
  const { data, isPending } = useCurrentUser()
  const logout = useLogout()
  const [profileOpen, setProfileOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const user = data?.user

  // Same footprint as the loaded trigger (the name slot has one fixed width in both), so nothing
  // in the header, the language switcher included, moves when the user arrives.
  if (isPending) return <AccountMenuSkeleton />
  if (!user) return null
  const label = user.name || user.email

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          render={<Button variant="ghost" className="h-auto gap-2 px-2 py-1" />}
          aria-label={t('menuLabel')}
        >
          <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
          <span className="hidden w-36 truncate text-left text-sm sm:inline-block">{label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">{label}</span>
              {user.name && <span className="truncate">{user.email}</span>}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setProfileOpen(true)}>
            <UserRound className="size-4" />
            {t('profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut className="size-4" />
            {tAuth('logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} finalFocus={trigger} />
    </>
  )
}

function AccountMenuSkeleton() {
  return (
    <div aria-hidden="true" className="flex items-center gap-2 px-2 py-1">
      <Skeleton className="size-8 rounded-full" />
      <Skeleton className="hidden h-4 w-36 sm:block" />
    </div>
  )
}
