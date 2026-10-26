/**
 * English copy used by the RegisterForm component test. A local copy on purpose: a test that
 * imports the real catalogue would need a locale seam in a single-locale fork. The shipped
 * strings are checked in the browser (mocked lane) and by the catalogue tests.
 */
export const registerFormMessages = {
  common: { showPassword: 'Show password', hidePassword: 'Hide password' },
  auth: {
    name: 'Name',
    email: 'Email',
    password: 'Password',
    register: 'Sign up',
    registering: 'Signing up...',
    passwordRequirements: 'Use at least 8 characters.',
    registrationCreatedLink: 'Go to sign in',
    registrationUnknownHelp:
      'If you already tried to register, try signing in with the same email and password.',
  },
  errors: {
    UNKNOWN_ERROR: 'Something went wrong. Please try again.',
    NETWORK_ERROR: 'Network error. Check your connection and try again.',
    EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
    REGISTRATION_SIGN_IN_REQUIRED:
      'Your account was created, but we could not sign you in. Try signing in later with the same email and password.',
    correlationHint: 'Reference: {id}',
  },
}
