# Use sign-in protection

After the deployment owner [activates MFA](mfa-deployment.md), operators use a local
password plus an authenticator code or an unused backup code. Initial enrollment
is unavailable to never-protected ordinary users. Already protected accounts stay
protected after a role change. Prepared deployments refuse operator access.

## Open the journey

Sign-in opens `/mfa` when further proof or setup is required. Signed-in users open
**Sign-in protection** at `/account/security`. Multi-locale builds add the locale
prefix. Product administration uses its configured placement with these suffixes;
see [placement and sessions](../product-admin/placement-and-sessions.md).

In the Operations Console, open your profile menu in the header and select
**Profile settings**. The profile page stays inside the Console. Protection actions
open a dialog over that page. The same profile menu contains **Sign out**.

Pending pages grant no ordinary session. If the account has no local password,
complete the offered password-recovery path first. An OAuth provider cannot
replace the protected account's local password or second factor.

## Initial setup and lost responses

1. Confirm your local password when requested.
2. Open Google Authenticator, Microsoft Authenticator or another compatible app.
   Add an account and scan the QR code. Manual entry is available if scanning fails.
3. Enter the six-digit **Code from your app** and continue.
4. Copy or download the ten backup codes. Store them somewhere accessible without
   your phone. Select **I have saved my backup codes**, then **Finish setup**.

```text
Password -> connect app -> verify app code -> save backup codes -> session
```

Each backup code works once. The application cannot display the issued set again.
Copying or downloading does not confirm saving. The application cannot erase your
clipboard, downloads or screenshots. QR generation and code downloads are local.

If a response is lost, select **Check result** before submitting anything again.
This checks the existing operation without resubmitting your code. An unfinished
session publication can repeat only its existing acknowledgement. A status read cannot
show a seed or backup set. If setup needs replacement codes, use the connected
app's next unused code. If the browser could not retain the setup continuation,
sign in again. The app stays bound; the new flow requires its next unused code.
An old code set cannot be confirmed after a newer set replaces it.

## Sign in without your phone

Enter your password, then select **No access to your app? Use a backup code**.
Enter one unused **Backup code**. This grants ordinary access without replacing
or disconnecting your app. The last code is valid too.

After entry, **Create new codes** can use the still-fresh password and backup-code
confirmation from that session. If either confirmation expires, confirm again.
If you have no unused codes, use the app or the administrator recovery below.

A lost response can consume the last code without delivering a usable session.
Select **Check result** first. If the browser can recover the exact completed
result, continue. Otherwise sign in with another unused code or the app. If
neither is available, request administrator recovery. Do not reuse the consumed
code or assume that the browser can always recover a session.

## Maintain your protection

**Sign-in protection** shows the number of unused backup codes.

- **Create new codes** requires fresh password and second-factor confirmation.
  It invalidates unused old codes. It keeps the current session and other valid
  sessions signed in. Save and acknowledge the new set.
- **Replace authenticator app** requires confirmation of the existing protection.
  Connect and verify the new app. This retires old sessions and replaces old codes.
  Save its new codes before completing the successor session. A failure after
  binding does not restore the old app. Sign in again if the setup result is lost.

For either action, check an uncertain result before retrying. A status response
never redisplays the new codes. A revoked original session or changed browser
context requires a new sign-in; another login cannot adopt its pending operation.
If starting an action loses its response, **Check result** restores that exact
browser operation when its continuation was retained. Otherwise it closes only
an unchanged start before offering a deliberate new action. If the operation
already progressed, check the current protection status before doing anything else.

After the final login proof, the browser completes sign-in automatically. If the
result stays unknown, use **Check result** or **Sign in again**. The deliberate
`/sign-in-again` route works even when an older session remains. It never signs
out on a page read. A live unfinished login must be opened and completed or
canceled before another attempt.

Console sign-out records its return destination;
only the matching next login can use it. An expired or competing return falls
back to the Console overview. If the sign-out result cannot be confirmed, select
**Start a new sign-in**. This drops the previous return destination and asks you
to sign in again. It does not claim that the earlier sign-out succeeded.

## Confirm a sensitive action

Enter the requested password and app or unused backup code. Password confirmation
alone does not complete MFA. The interface retries the original action only after
all required confirmations succeed. Canceling the dialog prevents a late response
from retrying it. If a response is lost, select **Check result** first.

## Recover without your app or backup codes

Contact your deployment administrator through your organization's approved private
channel. Support contact alone does not authorize a reset. The administrator must
follow [offline recovery](mfa-deployment.md#recover-an-account-without-its-app-or-codes).
This reset signs out existing sessions and invalidates old app codes, backup codes
and pending continuations. It cannot restore the old app afterward.

The administrator supplies a single-use ticket that expires after 15 minutes.
Sign in with your password. On the code screen, select **Code from the server
administrator**. Enter your local password and the ticket in that recovery form. This ticket is not a backup code. Connect a new app, verify its
code and save the new backup set. Ticket redemption alone gives no ordinary access.

If the administrator loses the ticket or cannot confirm its delivery, ask for
another confirmed reset. If your redemption response is lost, check the result.
If the browser did not retain its successor, ask for another ticket. Each new
reset invalidates prior tickets and revokes sessions again. The consumed ticket
cannot reconstruct its successor. If your password is unavailable, complete the
normal password-recovery path before the administrator issues a ticket.

## Ask for help safely

Use the organization's published support contact. AMCore does not provide a
support reset screen or a universal support address. Describe the approximate
time, page, action, displayed error code or reference, and which response was lost.
State whether you still have the phone or unused codes; do not send their values.
Provide only the account identification required by that approved private channel.

Never send passwords, app codes, QR codes, setup keys, backup codes, recovery
tickets, encryption keys, tokens or cookies. Do not attach unsanitized screenshots,
logs or database copies. This guide does not authorize sharing fleet artifacts,
audit records or other users' details. Support cannot bypass the administrator's
recovery permissions.

## Integration and safe UI inspection

Developers: use the [browser adapter contract](mfa-foundation.md#browser-adapter-contract)
and [extension instructions](mfa-foundation.md#extend-mfa-to-other-users).
For a simulated UI preview, use an owned managed stand with
`--profile account-mfa-ui`; see [local stands](../operations/local-stands.md#account-security-ui-preview).
Simulation does not prove enrollment, recovery, publication or enforcement.
