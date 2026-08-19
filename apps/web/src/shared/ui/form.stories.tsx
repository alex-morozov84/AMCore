import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { z } from 'zod'

import { Button } from './button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form'
import { Input } from './input'

// Minimal local schema — this story demonstrates the Form/FormField/
// FormItem/FormLabel/FormControl/FormMessage compound API itself, not a
// specific feature's validation rules. The real usage pattern this mirrors:
// features/auth-login/ui/LoginForm.tsx composes the same primitives with
// `@amcore/shared`'s `loginSchema` and `useLocalizedForm()`.
const demoSchema = z.object({
  email: z.string().trim().pipe(z.email()),
})

type DemoValues = z.infer<typeof demoSchema>

function DemoForm({ triggerValidationOnMount }: { triggerValidationOnMount?: boolean }) {
  const form = useForm<DemoValues>({
    resolver: zodResolver(demoSchema),
    defaultValues: { email: '' },
  })

  useEffect(() => {
    if (triggerValidationOnMount) {
      void form.trigger()
    }
  }, [triggerValidationOnMount, form])

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(() => {})} noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="email@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  )
}

const meta = {
  title: 'shared/ui/Form',
  component: DemoForm,
} satisfies Meta<typeof DemoForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithValidationError: Story = {
  args: { triggerValidationOnMount: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      const message = canvasElement.querySelector('[data-slot="form-message"]')
      expect(message).not.toBeNull()
      expect(message).not.toBeEmptyDOMElement()
    })
    expect(canvas.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true')
  },
}
