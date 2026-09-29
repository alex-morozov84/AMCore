export type OrganizationContextInput =
  { kind: 'list'; page: number; locale: string } | { kind: 'selected'; id: string; locale: string }

export const organizationContextTarget = (input: OrganizationContextInput) =>
  input.kind === 'list'
    ? `list:${input.page}:${input.locale}`
    : `selected:${input.id}:${input.locale}`

export const organizationContextKey = (binding: string, input: OrganizationContextInput) =>
  ['organization-context', binding, organizationContextTarget(input)] as const
