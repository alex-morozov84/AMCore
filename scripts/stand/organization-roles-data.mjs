// Reproducible dataset for the `organization-roles` preview profile: three organizations, 55 custom
// roles, 220 fake members and 14 invitations, written only through marker-locked fixture SQL.
// Wording avoids words the fixture SQL guard rejects (it matches them in any position and case).

export const ORGANIZATIONS = [
  { key: 1, name: 'Acme Studio', slug: 'acme-studio', members: 120 },
  { key: 2, name: 'Beta Labs', slug: 'beta-labs', members: 60 },
  { key: 3, name: 'Gamma Works', slug: 'gamma-works', members: 40 },
]

const OWN = '{"id":"${user.organizationId}"}'
const preset = (action, level, fields = []) => ({
  action,
  subject: 'Organization',
  conditions: level === 'own' ? OWN : null,
  fields,
  inverted: false,
})
export const PRESET_RULES = {
  'read:own': preset('read', 'own'),
  'read:all': preset('read', 'all'),
  'update:own': preset('update', 'own', ['name', 'slug']),
  'update:all': preset('update', 'all', ['name', 'slug']),
  'delete:own': preset('delete', 'own'),
  'delete:all': preset('delete', 'all'),
  'team:all': {
    action: 'manage',
    subject: 'TeamAccess',
    conditions: null,
    fields: [],
    inverted: false,
  },
}
const advanced = (action, subject, fields = [], inverted = false, conditions = null) => ({
  action,
  subject,
  conditions: conditions && JSON.stringify(conditions),
  fields,
  inverted,
})

const LONG =
  'Handles everything that reaches the regional desk, including escalations from partners, and keeps the weekly report current.'

/** `rules` entries are preset keys or raw advanced rules; `shared` links one rule to a sibling role. */
export const ROLES = {
  1: [
    ['Support agent', 'Answers customer requests.', ['read:all']],
    ['Billing viewer', 'Sees invoices and plans.', ['read:own']],
    ['Content editor', 'Edits public pages.', ['read:all', 'update:own']],
    ['Operations lead', LONG, ['read:all', 'update:all']],
    ['Account manager', 'Owns customer accounts.', ['read:own', 'update:own']],
    ['Auditor', 'Read-only review of the organization.', ['read:all']],
    ['Regional manager', null, ['read:all', 'update:own']],
    ['Onboarding specialist', 'Guides new customers.', ['read:own']],
    ['Team coordinator', 'Can manage roles and members.', ['read:all', 'team:all']],
    [
      'Data steward',
      'Has a field-limited user rule.',
      ['read:all', advanced('read', 'User', ['id', 'email'])],
    ],
    [
      'Compliance reviewer',
      'Cannot delete the organization.',
      ['read:all', advanced('delete', 'Organization', [], true)],
    ],
    [
      'Finance analyst',
      'Has a conditional rule.',
      ['read:own', advanced('read', 'User', [], false, { id: '${user.sub}' })],
    ],
    [
      'Security reviewer',
      'Denies slug edits.',
      ['read:all', advanced('update', 'Organization', ['slug'], true)],
    ],
    [
      'Combined part A',
      'Reads some fields and edits the name.',
      [
        advanced('read', 'Organization', ['id', 'name', 'slug']),
        advanced('update', 'Organization', ['name']),
      ],
    ],
    [
      'Combined part B',
      'Reads the remaining fields.',
      [advanced('read', 'Organization', ['aclVersion', 'createdAt', 'updatedAt'])],
    ],
    ['Duplicate presets', 'Stores the same preset twice.', ['read:own', 'read:own']],
    ['Shared permission A', 'Shares one rule with B.', ['shared']],
    ['Shared permission B', 'Shares one rule with A.', ['shared']],
    ['Empty role', 'No capabilities yet.', []],
    ['Broad delete', 'Can delete the organization.', ['read:all', 'delete:all']],
    ...[
      'Quality assurance',
      'Launch manager',
      'Sales manager',
      'Marketing editor',
      'Community moderator',
      'Partner manager',
      'Legal reviewer',
      'Procurement',
      'Facilities',
      'Training coordinator',
      'Research analyst',
      'Product owner',
      'Design lead',
      'Customer success',
      'Field technician',
      'Warehouse lead',
      'Payroll viewer',
      'Project manager',
      'Cross-functional regional operations coordinator',
    ].map((name, i) => [
      name,
      i % 3 === 0 ? null : `Works with the ${name.toLowerCase()} team.`,
      i % 2 ? ['read:all'] : ['read:own', 'update:own'],
    ]),
    ['Preview self-held role', 'The preview user holds this role.', ['read:all', 'update:own']],
  ],
  2: [
    ...[
      'Analyst',
      'Editor',
      'Reviewer',
      'Coordinator',
      'Support tier one',
      'Support tier two',
      'Viewer plus',
      'Billing contact',
      'Integration owner',
      'Lab manager',
      'Intern',
    ].map((name, i) => [
      name,
      `${name} in Beta Labs.`,
      i % 2 ? ['read:all'] : ['read:own', 'update:own'],
    ]),
    ['Oversized sample', 'More rules than the editor can change.', ['oversized']],
  ],
  3: [
    ['Solo admin helper', 'Helps the only administrator.', ['read:all', 'update:own']],
    ['Viewer plus', 'Read access with a note.', ['read:all']],
    ['Outside reviewer', 'Temporary external access.', ['read:own']],
  ],
}

export const INVITATIONS = [
  { org: 1, n: 1, roles: [1, 2], state: 'pending' },
  { org: 1, n: 2, roles: [3], state: 'pending' },
  { org: 1, n: 3, roles: [2, 3, 4], state: 'pending' },
  { org: 1, n: 4, roles: [1], state: 'pending' },
  { org: 1, n: 5, roles: [], state: 'pending' },
  { org: 1, n: 6, roles: [5], state: 'expired' },
  { org: 1, n: 7, roles: [6], state: 'revoked' },
  { org: 1, n: 8, roles: [7], state: 'accepted' },
  { org: 2, n: 9, roles: [0, 1], state: 'pending' },
  { org: 2, n: 10, roles: [2], state: 'pending' },
  { org: 2, n: 11, roles: [3], state: 'expired' },
  { org: 2, n: 12, roles: [1], state: 'revoked' },
  { org: 3, n: 13, roles: [0], state: 'pending' },
  { org: 3, n: 14, roles: [1], state: 'expired' },
]
