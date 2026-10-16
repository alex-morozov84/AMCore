import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Only `shared/lib/seo` may write a `robots` metadata key.
 *
 * Next merges metadata SHALLOWLY: a page-level `robots` replaces the layout's whole object. So a
 * page reopens indexing without ever writing `index: true`: `robots: 'index, follow'`,
 * `robots: { googleBot: { index: true } }`, `robots: { nocache: true }` (drops the inherited
 * `index: false`), a spread of an object defined elsewhere (caught where that object is defined),
 * or `other: { robots: ... }`. Banning the key itself closes every such form. Private pages that
 * want an explicit close import `noindexMetadata`.
 *
 * The scan matches property names (identifier, string, template or computed string) and
 * assignments to `.robots` / `['robots']`. It is non-vacuous: the self-test below injects each
 * forbidden form and requires a finding, and requires the allowed forms to produce none.
 */
const SRC_ROOT = path.resolve(import.meta.dirname, '../../..')
const SEO_DIR = path.join(SRC_ROOT, 'shared', 'lib', 'seo')

function isRobotsName(name: ts.PropertyName | ts.Expression): boolean {
  if (ts.isIdentifier(name)) return name.text === 'robots'
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    return name.text === 'robots'
  if (ts.isComputedPropertyName(name)) return isRobotsName(name.expression)
  return false
}

export function findRobotsKeys(source: string, fileName = 'file.tsx'): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const lines: number[] = []
  const report = (node: ts.Node) =>
    lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
  const visit = (node: ts.Node) => {
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)) &&
      isRobotsName(node.name)
    )
      report(node)
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'robots') report(node)
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'robots') ||
        (ts.isElementAccessExpression(node.left) && isRobotsName(node.left.argumentExpression)))
    )
      report(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return lines
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        !file.startsWith(SEO_DIR + path.sep) &&
        !/\.(test|spec|stories)\.(ts|tsx)$/.test(file) &&
        !file.endsWith('.d.ts')
    )
}

describe('the robots metadata key belongs to shared/lib/seo', () => {
  it('no other source file writes it', () => {
    const files = sourceFiles(SRC_ROOT)
    expect(files.length, 'the scan itself must not be vacuous').toBeGreaterThan(100)
    const offenders = files.flatMap((file) =>
      findRobotsKeys(readFileSync(file, 'utf8'), file).map(
        (line) => `${path.relative(SRC_ROOT, file)}:${line}`
      )
    )
    expect(offenders, 'use noindexMetadata or buildPageMetadata from shared/lib/seo').toEqual([])
  })
})

describe('the scan catches every form that reopens or rewrites indexing', () => {
  it.each([
    ['an object property', `export const metadata = { robots: { index: true } }`],
    ['the string form', `export const metadata = { robots: 'index, follow' }`],
    ['a googleBot override', `export const metadata = { robots: { googleBot: { index: true } } }`],
    [
      'a partial object that drops the inherited noindex',
      `export const m = { robots: { nocache: true } }`,
    ],
    ['a quoted key', `export const m = { 'robots': 'all' }`],
    ['a double-quoted key', `export const m = { "robots": 'all' }`],
    ['a computed key', `export const m = { ['robots']: 'all' }`],
    ['a template key', 'export const m = { [`robots`]: "all" }'],
    ['a shorthand property', `const robots = 'all'; export const m = { robots }`],
    ['a nested other.robots', `export const m = { other: { robots: 'all' } }`],
    ['a method', `export const m = { robots() { return 'all' } }`],
    ['a getter', `export const m = { get robots() { return 'all' } }`],
    ['a dot assignment', `const m: any = {}; m.robots = 'all'`],
    ['a bracket assignment', `const m: any = {}; m['robots'] = 'all'`],
    [
      'a key inside generateMetadata',
      `export async function generateMetadata() { return { robots: {} } }`,
    ],
  ])('finds %s', (_name, source) => {
    expect(findRobotsKeys(source)).not.toHaveLength(0)
  })

  it.each([
    ['an unrelated variable', `const robots = 1; console.log(robots)`],
    ['the route handler name', `export default function robots() { return { rules: [] } }`],
    ['a type name', `import type { MetadataRoute } from 'next'; type R = MetadataRoute.Robots`],
    ['a comment', `// robots: { index: true }\nexport const a = 1`],
    [
      'the safe helper',
      `import { noindexMetadata } from '@/shared/lib/seo/page-metadata'; export const metadata = noindexMetadata`,
    ],
    ['a spread of the safe helper', `export const m = { title: 'x', ...noindexMetadata }`],
    ['a string that mentions it', `export const a = 'robots'`],
  ])('does not flag %s', (_name, source) => {
    expect(findRobotsKeys(source)).toHaveLength(0)
  })
})
