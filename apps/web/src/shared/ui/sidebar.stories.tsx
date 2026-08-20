import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { LayoutDashboard, Users } from 'lucide-react'
import { expect, userEvent, waitFor } from 'storybook/test'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from './sidebar'

// A minimal stand-in for `widgets/app-shell/ui/AppShell.tsx` — enough to
// demonstrate the primitive's composition and interaction without pulling in
// real auth/locale/logout features. `mobileTitle`/`mobileDescription`/
// `toggleLabel` are required props (no baked-in English) — see
// docs/frontend/shared-ui-and-shadcn.md → "Hardcoded copy still slips in".
function SidebarDemo() {
  return (
    <SidebarProvider>
      <Sidebar mobileTitle="Navigation" mobileDescription="Site navigation menu">
        <SidebarHeader>
          <span className="px-2 py-1.5 font-semibold">AMCore</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Users />
                    <span>Active sessions</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <span className="truncate px-2 text-sm text-muted-foreground">user@example.com</span>
        </SidebarFooter>
        <SidebarRail toggleLabel="Toggle sidebar" />
      </Sidebar>
      {/* `SidebarInset` already renders the page's `<main>` landmark — see
      widgets/app-shell/ui/AppShell.tsx for why this stays a `<div>`. */}
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger toggleLabel="Toggle sidebar" />
        </header>
        <div className="p-4 text-sm text-muted-foreground">Page content</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

const meta = {
  title: 'shared/ui/Sidebar',
  component: SidebarDemo,
} satisfies Meta<typeof SidebarDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// Real interaction: the trigger toggles `data-state` between expanded/
// collapsed — the same mechanism `widgets/app-shell` relies on, verified
// live against a real page in `ai/models-talk.md`'s Track 9 PR3 handoff.
// Queried by `data-slot`, not accessible name: `SidebarTrigger` and
// `SidebarRail` share the same `toggleLabel` on purpose (they do the same
// thing), which makes `getByRole('button', { name: ... })` ambiguous here.
export const ToggleCollapse: Story = {
  play: async ({ canvasElement }) => {
    const sidebar = canvasElement.querySelector('[data-slot="sidebar"]')
    const trigger = canvasElement.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')
    expect(sidebar).toHaveAttribute('data-state', 'expanded')

    await userEvent.click(trigger!)
    await waitFor(() => expect(sidebar).toHaveAttribute('data-state', 'collapsed'))
  },
}
