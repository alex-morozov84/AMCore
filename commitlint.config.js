export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Type must be one of these
    'type-enum': [
      2,
      'always',
      [
        'feat', // New feature
        'fix', // Bug fix
        'docs', // Documentation
        'style', // Formatting (no code change)
        'refactor', // Code restructuring
        'perf', // Performance improvement
        'test', // Adding/updating tests
        'build', // Build system changes
        'ci', // CI/CD changes
        'chore', // Maintenance
        'revert', // Revert previous commit
      ],
    ],
    // Scope is optional but if present, must be one of these
    'scope-enum': [
      1, // Warning, not error
      'always',
      [
        'api',
        'web',
        'shared',
        'auth',
        'fitness',
        'finance',
        'subscriptions',
        'ci',
        'docs',
        'deps',
      ],
    ],
    // Subject (description) rules
    'subject-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'subject-max-length': [2, 'always', 72],
    // Body rules
    'body-max-line-length': [2, 'always', 100],
  },
};
