'use client'

import { createContext, useContext } from 'react'

import { OAuthProviderActions, type OAuthProviderActionsProps } from '@/features/auth-oauth'

export const RecipientOAuthScope = createContext<Omit<
  OAuthProviderActionsProps,
  'providers'
> | null>(null)

export function RecipientOAuthOptions({ providers }: Pick<OAuthProviderActionsProps, 'providers'>) {
  const scope = useContext(RecipientOAuthScope)
  if (!scope) throw new Error('Missing recipient OAuth scope')
  return <OAuthProviderActions {...scope} providers={providers} />
}
