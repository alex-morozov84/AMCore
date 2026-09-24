import type { AuditAction } from '@amcore/shared'

/** Translation values are supplied by the route when the integration slot is assigned. */
export interface AuditCopy {
  title: string
  description: string
  loading: string
  actorId: string
  targetId: string
  organizationId: string
  action: string
  actionHelp: string
  allActions: string
  actions: Record<AuditAction, string>
  from: string
  to: string
  localTime: string
  recentDay: string
  recentWeek: string
  customRange: string
  apply: string
  clear: string
  invalidFilters: string
  invalidCursor: string
  resetCursor: string
  empty: string
  noMatches: string
  end: string
  older: string
  previous: string
  currentIdentity: string
  noCurrentRecord: string
  unavailableIdentity: string
  unknownId: string
  actor: string
  target: string
  organization: string
  eventId: string
  types: Record<string, string>
  unknownAction: string
  copyId: string
  copied: string
  copyFailed: string
  filterActor: string
  filterTarget: string
  filterOrganization: string
  filterAction: string
  lookupUser: string
  lookupOrganization: string
  lookupSearch: string
  lookupSubmit: string
  lookupError: string
  lookupRefine: string
  lookupSelect: string
  timestampUtc: string
  summaryBeforeRole: string
  summaryAfterRole: string
  summaryCount: string
  summaryDecision: string
  summaryReasonCode: string
  summaryOutcome: string
}
