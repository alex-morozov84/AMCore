import { localeApiSeams } from './locale-ownership-seams-api.mjs'
import { localeBrowserSeams } from './locale-ownership-seams-browser.mjs'
import { localeCoreSeams } from './locale-ownership-seams-core.mjs'

export const localeOwnershipSeams = [...localeBrowserSeams, ...localeCoreSeams, ...localeApiSeams]
