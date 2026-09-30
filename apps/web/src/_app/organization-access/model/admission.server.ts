import { cache } from 'react'
import { headers } from 'next/headers'

import { readOrganizationBootstrap } from '@/entities/organization-context/index.server'

import 'server-only'

export const safeOrganizationAdmission = cache(async () =>
  readOrganizationBootstrap(await headers())
)
