import { formatInputInstant, parseInputInstant } from './AuditTimeZone'

type Mode = 'utc' | 'local'
export interface AuditEndpoint {
  instant: string | null
  text: string
  editMode: Mode
  invalid: boolean
  dirty: boolean
}

export function knownAuditEndpoint(instant: string, mode: Mode): AuditEndpoint {
  return {
    instant,
    text: formatInputInstant(instant, mode),
    editMode: mode,
    invalid: false,
    dirty: false,
  }
}

export function editAuditEndpoint(text: string, mode: Mode): AuditEndpoint {
  const instant = parseInputInstant(text, mode)
  return { instant, text, editMode: mode, invalid: !instant, dirty: true }
}

/** Known instants project without reparsing; invalid drafts retain their edit provenance. */
export function projectAuditEndpoint(endpoint: AuditEndpoint, mode: Mode): AuditEndpoint {
  return endpoint.instant
    ? { ...endpoint, text: formatInputInstant(endpoint.instant, mode) }
    : endpoint
}
