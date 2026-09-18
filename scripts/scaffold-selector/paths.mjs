import { fail } from './errors.mjs'

function hasControl(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0)
    return code <= 31 || code === 127
  })
}

export function validatePath(value, label = 'path') {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) {
    fail('declaration_invalid', `${label} must be a non-empty repository-relative path`)
  }
  if (hasControl(value) || value.split('/').some((part) => !part || part === '..')) {
    fail('declaration_invalid', `${label} contains a forbidden segment or control character`)
  }
  return value
}

function escapeRegex(character) {
  return /[.()+^$|{}[\]\\]/u.test(character) ? `\\${character}` : character
}

export function globRegex(pattern) {
  validatePath(pattern, 'glob')
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character !== '*') {
      source += character === '?' ? '[^/]' : escapeRegex(character)
      continue
    }
    if (pattern[index + 1] !== '*') {
      source += '[^/]*'
      continue
    }
    index += 1
    source += pattern[index + 1] === '/' ? '(?:.*/)?' : '.*'
    if (pattern[index + 1] === '/') index += 1
  }
  return new RegExp(`${source}$`, 'u')
}

export function patternMatches(kind, pattern, pathname) {
  if (kind === 'path') return pathname === pattern
  if (kind === 'root') return pathname === pattern || pathname.startsWith(`${pattern}/`)
  return globRegex(pattern).test(pathname)
}

export function entryMatches(entry, pathname) {
  return entry.matcher.patterns.some((pattern) =>
    patternMatches(entry.matcher.kind, pattern, pathname)
  )
}

export function matchesForTree(matcher, files) {
  return files.filter((file) =>
    matcher.patterns.some((pattern) => patternMatches(matcher.kind, pattern, file))
  )
}
