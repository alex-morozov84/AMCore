export const messages = {
  memberRemoval: {
    title: 'Remove member from organization?',
    action: 'Remove from organization...',
    identity: '{organization} / {name} / {email}',
    selectedOrganization: 'Selected organization',
    warning:
      'The member will lose access to this organization. All their API keys for this organization will be permanently revoked. Rejoining will not restore these keys.',
    selfWarning: 'You are removing yourself. You will lose access to this organization.',
    confirm: 'Remove member',
    cancel: 'Cancel',
    pending: 'Removing member...',
    success: 'Member removed. Their API keys for this organization are permanently revoked.',
    refreshFailed: 'Removal is confirmed, but the list or your access could not be refreshed.',
    unknown:
      'The result could not be confirmed. The request may still finish. Check the current state before considering a new removal.',
    lastAdmin: 'Assign the ADMIN role to another member, then try removing this member again.',
    limit:
      'No changes were made: this member has more than 1000 unrevoked API keys, including expired keys. Contact the platform administrator to revoke the keys and complete removal.',
    check: 'Refresh member details',
    review: 'Review removal again...',
    same: 'This membership is still present. An earlier request may still finish. A new removal requires another confirmation.',
    different:
      'The person has a different membership now. Select them again from the current member list.',
    unavailable:
      'The membership or organization is unavailable. This does not confirm that your removal succeeded.',
    denied: 'Your access is unavailable. The current membership could not be checked.',
    error: 'The current state could not be checked. No removal was retried.',
    organizations: 'Back to organizations',
    successTitle: 'Member removed',
    selfSuccessTitle: 'You left the organization',
    selfSuccess:
      'Your access has ended. Your API keys for this organization are permanently revoked.',
    unknownTitle: 'Removal result not confirmed',
    lastAdminTitle: 'Cannot remove the last administrator',
    limitTitle: 'Member not removed',
    rejectedTitle: 'Could not remove member',
    memberIdentity: '{name} / {email}',
  },
  errors: {
    UNKNOWN_ERROR: 'Unknown error',
    correlationHint: 'Reference: {id}',
  },
}
