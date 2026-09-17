export const localeSeam = (id, path, selector, detectors, operationKey, extra = {}) => ({
  id,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind: 'structural-operation',
  selector,
  detectors,
  operationKey,
  disposition: 'rewrite',
  ...extra,
})
