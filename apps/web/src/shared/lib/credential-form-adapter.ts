import type { UserResponse } from '@amcore/shared'

/** Application-owned auth continuation. Resolve only after its session handoff is confirmed. */
export interface CredentialFormAdapter<TInput> {
  submit(input: TInput): Promise<{ user: UserResponse }>
  isCurrent(): boolean
  onSuccess(response: { user: UserResponse }): void | Promise<void>
}
