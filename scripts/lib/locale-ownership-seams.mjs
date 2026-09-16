const seam = (id, path, selector, detectors, operationKey, extra = {}) => ({
  id,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind: 'structural-operation',
  selector,
  detectors,
  operationKey,
  disposition: 'rewrite',
  ...extra,
})

export const localeOwnershipSeams = [
  seam(
    'locale.context',
    'PROJECT_CONTEXT.md',
    { identifiers: ['**i18n_mode:**', '**base_locale:**', '**supported_locales:**'] },
    ['locale-context'],
    'context-locale',
    { occurrences: 3 }
  ),
  seam(
    'locale.eslint-navigation',
    'apps/web/eslint.config.mjs',
    { identifiers: ['NAVIGATION_PATHS', 'project/import-guards-navigation-source'] },
    ['NAVIGATION_PATHS', 'project/import-guards-navigation-source'],
    'project-eslint-remove-navigation',
    { occurrences: 3, disposition: 'remove' }
  ),
  seam(
    'locale.request-catalogue',
    'apps/web/src/i18n/request.ts',
    { text: '../../messages/${locale}.json' },
    ['dynamic-catalogue-import'],
    'locale.request-config',
    { disposition: 'remove' }
  ),
  seam(
    'locale.email-verification-test',
    'apps/api/src/infrastructure/email/templates/email-verification.integration.spec.ts',
    { identifiers: ['EmailVerificationEmail(baseProps)'] },
    ['EmailVerificationEmail(baseProps)'],
    'locale.email-template-test',
    { occurrences: 2 }
  ),
  seam(
    'locale.org-invite-test',
    'apps/api/src/infrastructure/email/templates/org-invite.integration.spec.ts',
    { identifiers: ['OrgInviteEmail({ ...baseProps, hasAccount: true })'] },
    ['OrgInviteEmail({ ...baseProps, hasAccount: true })'],
    'locale.email-template-test'
  ),
  seam(
    'locale.password-reset-test',
    'apps/api/src/infrastructure/email/templates/password-reset.integration.spec.ts',
    { identifiers: ['PasswordResetEmail(baseProps)'] },
    ['PasswordResetEmail(baseProps)'],
    'locale.email-template-test',
    { occurrences: 3 }
  ),
]
