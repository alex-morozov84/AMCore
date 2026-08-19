import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table'

const sessions = [
  { device: 'Chrome on macOS', lastActive: '2 minutes ago' },
  { device: 'Safari on iPhone', lastActive: '3 days ago' },
  { device: 'Firefox on Windows', lastActive: '2 weeks ago' },
]

const meta = {
  title: 'shared/ui/Table',
  component: Table,
} satisfies Meta<typeof Table>

export default meta
type Story = StoryObj<typeof meta>

// Mirrors the real reference consumer:
// _pages/settings/SessionsPage/SessionsTable.tsx.
export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Device</TableHead>
          <TableHead>Last active</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.device}>
            <TableCell>{session.device}</TableCell>
            <TableCell>{session.lastActive}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

export const WithFooterAndCaption: Story = {
  render: () => (
    <Table>
      <TableCaption>Active sessions for your account.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Device</TableHead>
          <TableHead>Last active</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.device}>
            <TableCell>{session.device}</TableCell>
            <TableCell>{session.lastActive}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell>{sessions.length} sessions</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
}
