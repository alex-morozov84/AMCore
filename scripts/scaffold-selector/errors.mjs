export class SelectorError extends Error {
  constructor(code, detail) {
    super(detail)
    this.name = 'SelectorError'
    this.code = code
  }
}

export function fail(code, detail) {
  throw new SelectorError(code, detail)
}
