# Account-security preparation

**Sign-in protection** opens the account-security screen. It is unavailable in
this deployment: MFA enrollment and second-factor sign-in are not enabled.
The page cannot change the operator's protection or create recovery credentials.
Normal Console authentication remains unchanged.

The protected page uses logical `/account/security` under the Console's selected
public base. In host mode, `/mfa` is a separate pending-authentication page that
does not depend on admitted Console navigation. Path mode uses the website's
pending-authentication journey. A pending page never grants Console access.

The dedicated Console MFA BFF follows the canonical host and mutation-origin
checks. It returns only unavailable status or a refusal, with private no-store
responses. It never returns a credential or publishes a session cookie.
The Console entry disappears when the optional Console is removed. The
[retained account-security UI](../auth/mfa-browser.md) remains in the website and
product administration. Its prepared recovery states are not operational APIs.
