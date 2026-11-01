/**
 * Where the Console sends an operator who needs the public guides. The upstream repository is the
 * default; a downstream product that publishes its own copy of the documentation points this one
 * constant at it. Deliberately not an environment variable or a build parameter. `main` can differ
 * from the version that is deployed.
 */
export const DOCS_REPOSITORY_URL = 'https://github.com/alex-morozov84/AMCore'

/** A page in the repository, with an optional anchor (without `#`). */
export function docsPageHref(path: string, anchor?: string): string {
  return `${DOCS_REPOSITORY_URL}/blob/main/${path}${anchor ? `#${anchor}` : ''}`
}

/** A folder in the repository; GitHub renders it as a clickable list of files. */
export function docsFolderHref(path: string): string {
  return `${DOCS_REPOSITORY_URL}/tree/main/${path}`
}
