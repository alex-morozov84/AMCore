import type { useTranslations } from 'next-intl'

import { describeRoles } from '../model/access-view'

export type AccessTranslator = ReturnType<typeof useTranslations<'memberAccess'>>

/** A short, readable list of role names with how many more exist. */
export function describeText(
  refs: { roleIds: readonly string[]; total: number } | null,
  nameOf: (id: string) => string | undefined,
  t: AccessTranslator
): string {
  const { names, more } = describeRoles(refs, nameOf, t('roleUnknown'))
  return more > 0 ? `${names.join(', ')} ${t('rolesMore', { count: more })}` : names.join(', ')
}
