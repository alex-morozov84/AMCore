'use client';

import type { ReactNode } from 'react';

import { useServiceWorker } from '@/shared/hooks';

interface PWAProviderProps {
  children: ReactNode;
}

export function PWAProvider({ children }: PWAProviderProps) {
  // Register service worker on mount
  useServiceWorker();

  return <>{children}</>;
}
