export interface ConsoleSourceSelection {
  kind: 'queue' | 'work' | 'scheduled' | 'integration'
  id: string
  state?: 'failed'
}
export interface ConsoleSourceRequest {
  selection?: ConsoleSourceSelection
  invalid?: boolean
}
