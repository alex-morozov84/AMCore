function cloneAnswers(answers) {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [key, typeof value === 'string' ? value : value])
  )
}

export function buildBrandDesiredState(answers) {
  return Object.freeze({ answers: Object.freeze(cloneAnswers(answers)) })
}
