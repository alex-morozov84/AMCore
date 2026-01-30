'use client';

import type { ReactNode } from 'react';

import { QueryProvider } from '@/shared/api';
import { PWAProvider } from '@/shared/pwa';
import { AuthStoreProvider, UIStoreProvider } from '@/shared/store';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <QueryProvider>
      <AuthStoreProvider>
        <UIStoreProvider>
          <PWAProvider>{children}</PWAProvider>
        </UIStoreProvider>
      </AuthStoreProvider>
    </QueryProvider>
  );
}
