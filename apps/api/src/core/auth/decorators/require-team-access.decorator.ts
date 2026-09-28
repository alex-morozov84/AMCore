import { SetMetadata } from '@nestjs/common'

export const TEAM_ACCESS_KEY = 'require_team_access'
/** Full policy administration, bound to the named organization route parameter. */
export const RequireTeamAccess = (paramName: string): ReturnType<typeof SetMetadata> =>
  SetMetadata(TEAM_ACCESS_KEY, paramName)
