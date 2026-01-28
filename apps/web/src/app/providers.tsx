'use client';

import type { ReactNode } from 'react';

import { QueryProvider } from '@/shared/api';
import { UIStoreProvider } from '@/shared/store';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <QueryProvider>
      <UIStoreProvider>{children}</UIStoreProvider>
    </QueryProvider>
  );
}
