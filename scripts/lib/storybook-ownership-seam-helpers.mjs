export const seam = (id, path, seamKind, selector, detectors, extra = {}) => ({
  id,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind,
  selector,
  detectors,
  disposition: selector.replacement === undefined ? 'remove' : 'rewrite',
  operationKey: id,
  ...extra,
})

export const block = (start, end, extra = {}) => ({ start, end, ...extra })
