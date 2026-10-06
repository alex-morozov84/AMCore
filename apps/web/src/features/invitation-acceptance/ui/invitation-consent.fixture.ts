import type { InvitationConsentProps } from './invitation-consent'

export const readyInvitation: InvitationConsentProps['invitation'] = {
  state: 'ready',
  inviteId: 'invitation-example',
  generation: 2,
  organization: { id: 'organization-example', name: 'Acme Studio' },
  roles: [
    { id: 'member-example', name: 'MEMBER', description: 'Use the organization workspace.' },
    { id: 'editor-example', name: 'Editor', description: 'Create and edit project content.' },
  ],
  expiresAt: '2026-10-11T12:00:00.000Z',
}
