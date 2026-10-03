export class ContextRequestError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    readonly retryAfterSeconds?: number
  ) {
    super(errorCode)
  }
}
