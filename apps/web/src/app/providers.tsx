'use client';

import type { ReactNode } from 'react';

import { UIStoreProvider } from '@/shared/store';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <UIStoreProvider>{children}</UIStoreProvider>;
}
