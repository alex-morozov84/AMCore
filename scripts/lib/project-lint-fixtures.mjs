const NAVIGATION_CASES = ['locale Link', 'progress Link', 'allowed pathname', 'namespace helper']
const SIBLING_CASES = ['a slice may not import a sibling feature slice', 'relative sibling']
const ROUTE_CASES = ['literal locale path', 'locale palette']

/** Keep guard fixtures aligned with the selected single-locale topology. */
export function projectSingleLocaleLintFixtures(content) {
  const fixtures = JSON.parse(content)
  for (const name of [...NAVIGATION_CASES, ...SIBLING_CASES, ...ROUTE_CASES]) {
    if (fixtures.filter((fixture) => fixture.name === name).length !== 1) {
      throw new Error(`Lint fixture selector drift: ${name}`)
    }
  }
  return `${JSON.stringify(
    fixtures
      .filter((item) => !NAVIGATION_CASES.includes(item.name))
      .map((item) => ({
        ...item,
        ...(SIBLING_CASES.includes(item.name) && {
          code: item.code.replaceAll('locale-switcher', 'auth-logout'),
        }),
        ...(ROUTE_CASES.includes(item.name) && { file: item.file.replace('/[locale]/', '/') }),
      })),
    null,
    2
  )}\n`
}
