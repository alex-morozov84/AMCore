import type { UserResponse } from '@amcore/shared'

/** Application-owned auth continuation. Resolve only after its session handoff is confirmed. */
export interface CredentialFormAdapter<TInput, TPending = never> {
  submit(input: TInput): Promise<{ user: UserResponse } | TPending>
  isCurrent(): boolean
  onSuccess(response: { user: UserResponse }): void | Promise<void>
  onMfaRequired?(flowBinding: string): void | Promise<void>
}
