export interface IdempotencyOptions {
  scope: string
}

export type IdempotencyFailMode = 'open' | 'closed'

export interface CompletedIdempotencyRecord {
  status: number
  body: string
  headers: Record<string, string>
}

export type IdempotencyReserveResult =
  | { kind: 'started'; storageKey: string; ownerToken: string }
  | { kind: 'conflict' }
  | { kind: 'mismatch' }
  | { kind: 'replay'; response: CompletedIdempotencyRecord }
