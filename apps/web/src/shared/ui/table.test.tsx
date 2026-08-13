import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table'

describe('Table', () => {
  it('renders the full composition with each slot present', () => {
    render(
      <Table>
        <TableCaption>Active sessions</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Chrome on macOS</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )

    expect(screen.getByText('Active sessions')).toBeInTheDocument()
    expect(screen.getByText('Device')).toBeInTheDocument()
    expect(screen.getByText('Chrome on macOS')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('data-slot', 'table')
  })

  it('marks a selected row via data-state for downstream styling', () => {
    render(
      <Table>
        <TableBody>
          <TableRow data-state="selected" data-testid="row">
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )

    expect(screen.getByTestId('row')).toHaveAttribute('data-state', 'selected')
  })
})
