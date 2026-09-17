import { localeApiAuthSeams } from './locale-ownership-seams-api-auth.mjs'
import { localeApiNotificationSeams } from './locale-ownership-seams-api-notifications.mjs'

export const localeApiSeams = [...localeApiAuthSeams, ...localeApiNotificationSeams]
