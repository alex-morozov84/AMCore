import {
  E2E_ROUTE_SURFACES,
  OAUTH_E2E_ROUTE_SURFACE,
} from './project-locale-e2e-route-surfaces.mjs'
import { E2E_UI_PROFILES, E2E_UI_SURFACES } from './project-locale-e2e-ui-surfaces.mjs'
import { localeSeam } from './locale-ownership-seam.mjs'

const routeSeams = [...E2E_ROUTE_SURFACES, OAUTH_E2E_ROUTE_SURFACE].map(
  ([path, occurrences], index) =>
    localeSeam(
      `locale.e2e-route-${index + 1}`,
      path,
      { identifiers: ['/en', '/ru', '/(en|ru)'] },
      ['locale-prefixed-route'],
      'locale.e2e-route-topology',
      { occurrences }
    )
)

const uiSeams = E2E_UI_SURFACES.map(({ path, namespaces, expectedReferences }, index) =>
  localeSeam(
    `locale.e2e-ui-${index + 1}`,
    path,
    {
      identifiers: [
        ...new Set(namespaces.flatMap((name) => E2E_UI_PROFILES[name].map(([en]) => en))),
      ],
    },
    ['english-localized-ui-expectation'],
    'locale.e2e-ui-expectations',
    { occurrences: expectedReferences }
  )
)

export const localeBrowserSeams = [...routeSeams, ...uiSeams]
