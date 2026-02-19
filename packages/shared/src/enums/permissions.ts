// Action: what the user wants to do
export enum Action {
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
  Manage = 'manage', // wildcard: all actions
}

// Subject: which resource
// Note: domain subjects (Contact, Deal, Invoice) are added per-app, not here
export enum Subject {
  User = 'User',
  Organization = 'Organization',
  Role = 'Role',
  Permission = 'Permission',
  All = 'all', // wildcard: all subjects
}
