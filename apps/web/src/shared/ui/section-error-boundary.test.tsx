import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'

import { SectionErrorBoundary } from './section-error-boundary'

function renderBoundary(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SectionErrorBoundary>{children}</SectionErrorBoundary>
    </NextIntlClientProvider>
  )
}

describe('SectionErrorBoundary', () => {
  // The thrown-child -> fallback -> retry() path is exercised in
  // section-error-boundary.stories.tsx instead of here: `catchError`'s real
  // implementation reaches into Next's app-router client runtime
  // (`nav-failure-handler.ts`'s pending-navigation state), which plain
  // Vitest + Testing Library never initializes outside an actual Next app
  // router context - confirmed by a real `TypeError` reading `__pendingUrl`
  // when this case was tried here. `@storybook/nextjs-vite`'s
  // `parameters.nextjs.appDirectory` mock provides that context; Vitest's
  // jsdom environment does not. See docs/frontend/testing.md's taxonomy for
  // this "needs the real Next runtime" class of case.
  it('renders its children when nothing throws', () => {
    renderBoundary(<div>real content</div>)

    expect(screen.getByText('real content')).toBeInTheDocument()
  })
})
