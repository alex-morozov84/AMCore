import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConsoleSourceRequest } from './console-source-selection'
import { ConsoleSourceFocus } from './ConsoleSourceFocus'
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
const scroll = vi.fn()
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement
  ) {
    return (this.hidden ? [] : [{}]) as unknown as DOMRectList
  })
  HTMLElement.prototype.scrollIntoView = scroll
})
function tree(request: ConsoleSourceRequest, available = true, revision = 0) {
  return (
    <section id="list">
      <ConsoleSourceFocus rootId="list" request={request} available={available} />
      <button>Keep reading</button>
      <p hidden tabIndex={-1} data-console-source="scheduled:a">
        Hidden a
      </p>
      <p key={revision} tabIndex={-1} data-console-source="scheduled:a">
        Visible a
      </p>
      <p tabIndex={-1} data-console-source="scheduled:b">
        Visible b
      </p>
    </section>
  )
}
const selection = (id: string): ConsoleSourceRequest => ({ selection: { kind: 'scheduled', id } })
describe('source focus on navigation', () => {
  it('focuses the visible responsive target, not its hidden copy, and does not steal focus on refresh', async () => {
    const { rerender } = render(tree(selection('a')))
    expect(screen.getByText('Visible a')).toHaveFocus()
    screen.getByRole('button').focus()
    rerender(tree(selection('a'), true, 1))
    await waitFor(() => expect(screen.getByRole('button')).toHaveFocus())
    expect(scroll).toHaveBeenCalledTimes(1)
  })
  it('moves for A -> B -> Back A, including return after a plain list', () => {
    const { rerender } = render(tree(selection('a')))
    rerender(tree(selection('b')))
    expect(screen.getByText('Visible b')).toHaveFocus()
    rerender(tree(selection('a')))
    expect(screen.getByText('Visible a')).toHaveFocus()
    rerender(tree({}))
    screen.getByRole('button').focus()
    rerender(tree(selection('a')))
    expect(screen.getByText('Visible a')).toHaveFocus()
  })
  it('explains invalid and disappeared targets without mutation or extra lookups', () => {
    const { rerender } = render(tree({ invalid: true }))
    expect(screen.getByRole('status')).toHaveTextContent('focusInvalid')
    rerender(tree(selection('gone')))
    expect(screen.getByRole('status')).toHaveTextContent('focusMissing')
    rerender(tree(selection('gone'), false))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
