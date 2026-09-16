export const localeContent = (path, operationKey, locale, params = {}) => ({
  kind: 'content',
  dimension: 'locale',
  path,
  operationKey,
  params: { locale, ...params },
})

export const localeDelete = (path) => ({ kind: 'delete', dimension: 'locale', path })

export const localeMove = ({ from, to }) => ({
  kind: 'move',
  dimension: 'locale',
  from,
  to,
})
