export class ContextRequestError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string
  ) {
    super(errorCode)
  }
}
