import { fail } from './errors.mjs'
import { entryMatches, globRegex } from './paths.mjs'
import { reasonForInput } from './output.mjs'

const SELF_PROTECTED = ['scripts/scaffold-selector', '.github/workflows/ci.yml']

function inputMatches(declaration, pathname, status) {
  return declaration.inputs.filter(
    (input) => entryMatches(input, pathname) && input.statuses.includes(status)
  )
}

function safeMatches(declaration, pathname, status) {
  return declaration.safeInputs.filter(
    (input) => entryMatches(input, pathname) && input.statuses.includes(status)
  )
}

function selfProtected(pathname) {
  return SELF_PROTECTED.some(
    (protectedPath) => pathname === protectedPath || pathname.startsWith(`${protectedPath}/`)
  )
}

function matchRecord(change, inputs) {
  return {
    status: change.status,
    path: change.path,
    ...(change.oldPath ? { oldPath: change.oldPath } : {}),
    graphs: inputs.map((input) => input.graph).filter(Boolean),
    inputIds: inputs.map((input) => input.id),
  }
}

function markerText(readText, change) {
  const sides =
    change.status === 'A' ? ['head'] : change.status === 'D' ? ['base'] : ['base', 'head']
  const paths = change.status === 'R' ? [change.oldPath, change.path] : [change.path]
  const blobs = []
  for (let index = 0; index < sides.length; index += 1) {
    const pathname = paths[Math.min(index, paths.length - 1)]
    blobs.push(readText(sides[index], pathname))
  }
  return blobs
}

function markerInputs(declaration, change, readText) {
  const texts = markerText(readText, change)
    .filter((blob) => blob.kind === 'text')
    .map((blob) => blob.text)
  return declaration.markerPolicies
    .filter((policy) =>
      policy.markers.some((marker) => texts.some((text) => text.includes(marker)))
    )
    .map((policy) => ({
      id: `marker.${policy.id}`,
      graph: 'planning',
      rationale: 'A declared optional-feature marker changed and needs scaffold verification.',
    }))
}

function unknown(change, reason) {
  return {
    status: change.status,
    path: change.path,
    ...(change.oldPath ? { oldPath: change.oldPath } : {}),
    reason,
  }
}

function classifyOne(state, declaration, change, readText) {
  const paths = [change.oldPath, change.path].filter(Boolean)
  const direct = paths.flatMap((pathname) => inputMatches(declaration, pathname, change.status))
  const markers = markerInputs(declaration, change, readText)
  const control = paths.some(selfProtected)
    ? [{ id: 'control.self-protection', graph: 'control', rationale: 'Selector control changed.' }]
    : []
  const affected = [...direct, ...markers, ...control]
  if (affected.length) {
    state.matchedInputs.push(matchRecord(change, affected))
    state.reasons.push(...affected.map((input) => reasonForInput(input, paths)))
    return
  }
  const safe = paths.flatMap((pathname) => safeMatches(declaration, pathname, change.status))
  const blobs = markerText(readText, change)
  if (safe.length && blobs.every((blob) => blob.kind === 'text')) {
    state.matchedInputs.push(matchRecord(change, safe))
    return
  }
  const reason = safe.length
    ? 'safe_input_unreadable'
    : `${change.status.toLowerCase()}_not_proven_safe`
  state.unknownInputs.push(unknown(change, reason))
  state.reasons.push({ code: 'unknown_input', paths, detail: reason })
}

function membershipFiles(files, glob) {
  const matches = globRegex(glob)
  return files.filter((file) => matches.test(file)).sort()
}

function assertCardinality(entry, files, side) {
  const count = membershipFiles(files, entry.glob).length
  const valid = entry.cardinality === 'one' ? count === 1 : count > 0
  if (!valid) fail('declaration_stale', `${entry.id} ${side} cardinality is ${count}`)
}

function classifyMemberships(state, declaration, baseFiles, headFiles) {
  for (const entry of declaration.memberships) {
    assertCardinality(entry, baseFiles, 'base')
    const before = membershipFiles(baseFiles, entry.glob)
    const after = membershipFiles(headFiles, entry.glob)
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    state.reasons.push({
      code: 'glob_membership_changed',
      inputId: entry.id,
      paths: [...new Set([...before, ...after])],
      detail: `Declared ${entry.graph} glob membership changed.`,
    })
  }
}

export function classifyChanges({ declaration, changes, baseFiles, headFiles, readText }) {
  const state = { reasons: [], matchedInputs: [], unknownInputs: [], diagnostics: [] }
  if (changes.length === 0) {
    state.reasons.push({ code: 'empty_diff', paths: [], detail: 'An empty diff is not skippable.' })
  }
  classifyMemberships(state, declaration, baseFiles, headFiles)
  for (const change of changes) classifyOne(state, declaration, change, readText)
  return { ...state, required: state.reasons.length > 0 }
}
