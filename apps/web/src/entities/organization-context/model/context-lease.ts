export interface OrganizationContextRun {
  readonly binding: string
  readonly target: string
  readonly signal: AbortSignal
}

/** One consumer's publication lifetime; no shared selected organization or router state. */
export function createOrganizationContextLease() {
  let active: OrganizationContextRun | undefined
  let controller: AbortController | undefined
  const retire = () => {
    active = undefined
    controller?.abort()
    controller = undefined
  }
  return {
    retire,
    begin(binding: string, target: string): OrganizationContextRun {
      retire()
      controller = new AbortController()
      active = Object.freeze({ binding, target, signal: controller.signal })
      return active
    },
    publish(run: OrganizationContextRun, callback: () => void): boolean {
      if (active !== run || run.signal.aborted) return false
      callback()
      return true
    },
  }
}
