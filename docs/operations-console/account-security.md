# Sign-in protection in Console

Open **Sign-in protection** for your account. Follow the retained
[setup, backup-code and recovery instructions](../auth/mfa-browser.md).
The deployment owner must approve and complete [activation](../auth/mfa-deployment.md)
before operators can enter the final MFA-capable deployment.

Path-mode Console uses the website's selected session. Separate-host Console
uses its own secure cookie and session. Pending setup uses the minimal `/mfa`
page and does not require the admitted Console shell. The backend verifies current
account, family and browser authority on every protected request.

Removing optional Console removes its entry only. The website and product
administration retain account-security journeys for eligible or protected accounts.
