# Sign-in protection

After the deployment owner activates MFA, operators sign in with a local password
and an authenticator code or unused backup code. Before activation, the prepared
protocol refuses operator access. See [activation](../auth/mfa-deployment.md).

On first setup, scan the QR code with Google Authenticator, Microsoft Authenticator
or another compatible app. Enter its six-digit code. Save the ten backup codes
somewhere available without that phone, then confirm that you saved them.
Each backup code works once. The application cannot show the set again.

**Sign-in protection** opens your settings. It shows the remaining backup-code
count. **Create new codes** replaces the old set after fresh password and second-factor
confirmation. It keeps your current session and other valid devices signed in.
A lost response does not make a consumed code unused or restore an old set.

**Replace authenticator app** is separate. Confirm the existing protection, connect the new app,
and verify its code. This change signs out other sessions and replaces old codes.
Save the new backup set before completing the new sign-in. An error after binding
does not restore the old app. Sign in again if the setup response was lost.

If you have no phone, choose a backup code during sign-in. That grants normal
access after the password. It does not force you to replace the app. If no codes
remain, use the app or ask the deployment owner for
[offline recovery](../auth/mfa-foundation.md#internal-offline-recovery-boundary).

Path-mode Console uses the website's selected session. A separate-host Console
has its own secure cookie and session. Pending setup uses the minimal `/mfa`
page and does not require the admitted Console shell. The backend still verifies
the current account/family/browser on every protected request.

Removing the optional Console removes only its entry. The
[retained account-security journey](../auth/mfa-browser.md) remains available on
the website and product administration for eligible or already protected accounts.
