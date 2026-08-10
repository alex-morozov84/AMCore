import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageLoading } from './page-loading'

describe('PageLoading', () => {
  it('renders a centered, full-height loading spinner', () => {
    const { container } = render(<PageLoading />)

    expect(container.querySelector('[data-slot="spinner"]')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass(
      'min-h-screen',
      'items-center',
      'justify-center'
    )
  })
})
