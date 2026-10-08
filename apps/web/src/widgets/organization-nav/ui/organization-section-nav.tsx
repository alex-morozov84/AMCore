import { useTranslations } from 'next-intl'

import { SectionNavigation } from '@/shared/ui/section-navigation'

export type OrganizationSection = 'overview' | 'members' | 'invitations' | 'roles'

export type OrganizationSectionHrefs = Readonly<
  { overview: string } & Partial<Record<Exclude<OrganizationSection, 'overview'>, string>>
>

const ORDER: readonly OrganizationSection[] = ['overview', 'members', 'invitations', 'roles']

/**
 * The one route-backed navigation of an organization's management pages. A section appears only
 * when the caller passes its destination, so a downstream app can omit a tab it does not route.
 */
export function OrganizationSectionNav({
  active,
  hrefs,
}: {
  active: OrganizationSection
  hrefs: OrganizationSectionHrefs
}) {
  const t = useTranslations('organizationNav')
  const items = ORDER.flatMap((section) => {
    const href = hrefs[section]
    return href ? [{ label: t(section), href, active: section === active }] : []
  })
  return <SectionNavigation label={t('sections')} items={items} />
}
