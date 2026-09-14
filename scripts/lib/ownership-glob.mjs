import { readdirSync } from 'node:fs'
import path from 'node:path'

const META = /[.+^${}()|[\]\\]/g

function segmentPattern(segment) {
  return segment.replace(META, '\\$&').replaceAll('*', '[^/]*').replaceAll('?', '[^/]')
}

export function globRegex(glob) {
  const parts = glob.replaceAll('\\', '/').replace(/^\.\//, '').split('/')
  let source = '^'
  for (const [index, part] of parts.entries()) {
    if (part === '**') source += index === parts.length - 1 ? '.*' : '(?:[^/]+/)*'
    else source += `${segmentPattern(part)}${index === parts.length - 1 ? '' : '/'}`
  }
  return new RegExp(`${source}$`)
}

export function matchesGlob(filePath, glob) {
  return globRegex(glob).test(filePath.replaceAll('\\', '/'))
}

function walkDirectory(root, relative, output) {
  const absolute = path.join(root, relative)
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name)
    if (entry.isDirectory()) walkDirectory(root, child, output)
    else output.push(child)
  }
}

export function listFiles(root, roots) {
  const output = []
  for (const relative of roots) walkDirectory(root, relative, output)
  return [...new Set(output)].sort()
}

export function expandGlob(files, glob) {
  return files.filter((file) => matchesGlob(file, glob))
}
