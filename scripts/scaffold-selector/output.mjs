const GRAPH_CODES = {
  control: 'control_input_changed',
  planning: 'planning_input_changed',
  'generated-verification': 'verification_source_changed',
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

export function reasonForInput(input, paths) {
  return {
    code: GRAPH_CODES[input.graph],
    inputId: input.id,
    paths: sortedUnique(paths),
    detail: input.rationale,
  }
}

export function normalizeReasons(reasons) {
  const merged = new Map()
  for (const reason of reasons) {
    const key = `${reason.code}\0${reason.inputId ?? ''}\0${reason.detail ?? ''}`
    const prior = merged.get(key) ?? { ...reason, paths: [] }
    prior.paths = sortedUnique([...prior.paths, ...(reason.paths ?? [])])
    merged.set(key, prior)
  }
  return [...merged.values()].sort((left, right) =>
    `${left.code}:${left.inputId ?? ''}`.localeCompare(`${right.code}:${right.inputId ?? ''}`)
  )
}

export function normalizeMatches(matches) {
  const merged = new Map()
  for (const match of matches) {
    const key = `${match.status}\0${match.oldPath ?? ''}\0${match.path}`
    const prior = merged.get(key) ?? { ...match, graphs: [], inputIds: [] }
    prior.graphs = sortedUnique([...prior.graphs, ...match.graphs])
    prior.inputIds = sortedUnique([...prior.inputIds, ...match.inputIds])
    merged.set(key, prior)
  }
  return [...merged.values()].sort((a, b) =>
    `${a.path}:${a.status}`.localeCompare(`${b.path}:${b.status}`)
  )
}

export function buildDecision({ provenance, selectorVersion, classification }) {
  return {
    schemaVersion: '1.0.0',
    selectorVersion,
    mode: 'shadow',
    provenance,
    lanes: {
      universalFast: { required: true, actualExecution: 'run' },
      generatedFull: {
        required: classification.required,
        actualExecution: 'run-shadow',
      },
      exhaustiveBackstop: {
        required: false,
        actualExecution: 'scheduled-or-manual',
      },
    },
    reasons: normalizeReasons(classification.reasons),
    matchedInputs: normalizeMatches(classification.matchedInputs),
    unknownInputs: [...classification.unknownInputs].sort((a, b) =>
      `${a.path}:${a.status}`.localeCompare(`${b.path}:${b.status}`)
    ),
    diagnostics: [...classification.diagnostics].sort(),
  }
}

export function buildFallback({ reason, detail, provenance = {} }) {
  return buildDecision({
    selectorVersion: null,
    provenance: {
      event: provenance.event ?? 'unknown',
      baseRef: provenance.baseRef ?? null,
      baseSha: provenance.baseSha ?? null,
      headSha: provenance.headSha ?? null,
      mergeBaseSha: provenance.mergeBaseSha ?? null,
      diffRange: provenance.diffRange ?? null,
      declarationSha256: provenance.declarationSha256 ?? null,
      trustSource: 'merge-base',
    },
    classification: {
      required: true,
      reasons: [{ code: reason, paths: [], detail }],
      matchedInputs: [],
      unknownInputs: [],
      diagnostics: detail ? [detail] : [],
    },
  })
}
