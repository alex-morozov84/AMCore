'use client'

import { useEffect } from 'react'

import { startVersionChecker } from './checker'
import { DEPLOYMENT_VERSION } from './identity'

export function DeploymentVersionCheck() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    return startVersionChecker(DEPLOYMENT_VERSION)
  }, [])
  return null
}
