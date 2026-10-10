/** Registration labels are plain data, never message keys or HTML. English is the fallback. */
export function workLabel(
  labels: Readonly<Record<string, string>> | undefined,
  locale: string,
  fallback: string
): string {
  return labels?.[locale] ?? labels?.[locale.split('-')[0]!] ?? labels?.en ?? fallback
}
