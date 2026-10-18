export class ContextRequestError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    readonly retryAfterSeconds?: number,
    readonly details?: Record<string, unknown>
  ) {
    super(errorCode)
  }
}
