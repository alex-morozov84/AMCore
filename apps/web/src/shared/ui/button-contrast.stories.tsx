import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import axe from 'axe-core'
import { expect, waitFor, within } from 'storybook/test'

import { Button } from './button'
import { Card, CardContent } from './card'
import { ConfirmDialog } from './confirm-dialog'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './popover'

function DestructiveSurfaces() {
  const [open, setOpen] = useState(false)
  return (
    <main className="space-y-6 bg-background p-6 text-foreground">
      <h1>Destructive surfaces</h1>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Body action
      </Button>
      <Card>
        <CardContent>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Card action
          </Button>
        </CardContent>
      </Card>
      <Popover open>
        <PopoverTrigger render={<Button variant="outline" />}>Popover surface</PopoverTrigger>
        <PopoverContent>
          <PopoverTitle>Popover action</PopoverTitle>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Popover action
          </Button>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        variant="destructive"
        title="Confirm action?"
        description="This action cannot be undone."
        confirmLabel="Confirm action"
        cancelLabel="Cancel"
        onConfirm={() => {}}
      />
    </main>
  )
}

const meta = {
  title: 'shared/ui/ButtonContrast',
  component: DestructiveSurfaces,
} satisfies Meta<typeof DestructiveSurfaces>
export default meta
type Story = StoryObj<typeof meta>

async function settled(element: Element) {
  await waitFor(() => {
    element.getBoundingClientRect()
    expect(element.getAnimations({ subtree: true }).some((a) => a.playState === 'running')).toBe(
      false
    )
  })
}

async function checkSurfaces(canvasElement: HTMLElement, dark: boolean, surface: string) {
  // Trusted pointer movement is available in the Vitest browser runner.
  // A standalone Storybook preview remains an interactive component showcase.
  if (import.meta.env.MODE !== 'test') return
  const { page } = await import('vitest/browser')
  const document = canvasElement.ownerDocument
  const root = document.documentElement
  const wasDark = root.classList.contains('dark')
  const body = within(document.body)
  try {
    root.classList.toggle('dark', dark)
    await settled(document.body)
    if (surface !== 'Confirmation') {
      const button = await body.findByRole('button', { name: `${surface} action` })
      for (const hover of [false, true]) {
        await page.elementLocator(hover ? button : body.getByRole('heading', { level: 1 })).hover()
        await settled(button)
        await expect(button.matches(':hover')).toBe(hover)
        const result = await axe.run(button, { runOnly: ['color-contrast'] })
        await expect(result.violations).toEqual([])
        await expect(
          result.passes.find((rule) => rule.id === 'color-contrast')?.nodes
        ).toHaveLength(1)
      }
      return
    }
    await page.elementLocator(body.getByRole('button', { name: 'Card action' })).click()
    const dialog = await body.findByRole('alertdialog')
    await settled(dialog)
    const confirm = within(dialog).getByRole('button', { name: 'Confirm action' })
    for (const hover of [false, true]) {
      await page.elementLocator(hover ? confirm : within(dialog).getByRole('heading')).hover()
      await settled(confirm)
      await expect(confirm.matches(':hover')).toBe(hover)
      const result = await axe.run(confirm, { runOnly: ['color-contrast'] })
      await expect(result.violations).toEqual([])
      await expect(result.passes.find((rule) => rule.id === 'color-contrast')?.nodes).toHaveLength(
        1
      )
    }
    await page.elementLocator(within(dialog).getByRole('button', { name: 'Cancel' })).click()
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
  } finally {
    root.classList.toggle('dark', wasDark)
  }
}

function contrastStory(dark: boolean, surface: string): Story {
  return {
    globals: { theme: dark ? 'dark' : 'light' },
    play: ({ canvasElement }) => checkSurfaces(canvasElement, dark, surface),
  }
}

export const LightBody = contrastStory(false, 'Body')
export const LightCard = contrastStory(false, 'Card')
export const LightPopover = contrastStory(false, 'Popover')
export const LightConfirmation = contrastStory(false, 'Confirmation')
export const DarkBody = contrastStory(true, 'Body')
export const DarkCard = contrastStory(true, 'Card')
export const DarkPopover = contrastStory(true, 'Popover')
export const DarkConfirmation = contrastStory(true, 'Confirmation')
