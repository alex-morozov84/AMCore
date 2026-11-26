# Protect a public contact form

Use this example for a low-risk “Contact us” form that sends plain text to a mailbox configured by the product. The example uses AMCore's server-side limits and requires no external verification service.

## Run the example

1. In a clean development copy, run `git apply --check examples/public-contact/contact.patch`, then run `git apply examples/public-contact/contact.patch`.
2. Follow [local setup](../../README.md) with `EMAIL_PROVIDER=mock`. Start the API and web app. Open `/en/contact` or `/ru/contact` on the web origin with the default locale settings.
3. Send one message. Expect a confirmation and one `Email sent (MOCK)` event in the API log. The example sends directly and adds no database row or queue job.
4. Repeat a POST with the same `Idempotency-Key` and exact JSON bytes. Within the Redis replay window, expect the same receipt and no additional mail. Use a fresh UUID for each new submission.

The example's receiver is a reserved example address. Set an actual fixed recipient on the server when adapting the code. Keep the visitor's email in the message body.

### Check the example on an isolated stand

Run the checks from the copy where you applied the patch.

```bash
node scripts/api-e2e-ci.mjs --prepare
pnpm --filter api test:e2e --runTestsByPath test/public-contact.e2e-spec.ts
pnpm stand e2e --lane real-stack -- public-contact.spec.ts
```

The API test counts all deliveries in a test mailbox. The browser test drops the first HTTP response after the server accepts it, then retries with the original key and content. The browser test uses the isolated API's successful direct mail counter to detect duplicate effects. Keep the mock mail provider for these scenarios.

## Choose and check the safeguards

- Set a route-specific rate and burst. Start by checking real volume and shared-IP networks. Forward visitor IP through the [trusted relay](../frontend/api-consumption.md#server-request-boundary). On `429`, retain form values and wait for `Retry-After`.
- Validate the fields and bound request and message sizes on the API. Test a direct API request as well as the browser flow. Keep the hidden field outside keyboard and screen-reader navigation. Check actual browser autofill and fast valid submissions.
- Reject malformed input and a filled trap before saving, enqueuing or calling the mail provider. Check total effects in an isolated stand, including completed jobs. A trap catches simple bots and may miss targeted automation.
- If visitors can choose recipients, enforce a shared total mail budget before enqueue or send. An IP limit alone cannot cap aggregate sends. For costly or public effects, consider a total budget or bounded moderation.
- Retain the original key and payload after a lost response. The [Redis replay contract](../operations/idempotency.md) covers a completed response while its record survives. A lost record, expired lock or uncertain mail result requires a product-specific recovery policy.

## Add verification if spam still disrupts work

- **ALTCHA open-source core** runs on product infrastructure under MIT. The browser performs a computation. Host the widget locally and measure latency on slower phones. [ALTCHA documentation](https://altcha.org/docs)
- **Yandex SmartCaptcha** lists 10,000 eligible validations per month at zero cost in its Russian tariff. It uses external browser and server endpoints. A restricted billing account can return success for all validations. Check the expected hostname and handle empty hostname or an unavailable provider explicitly. [Tariff](https://yandex.cloud/ru/docs/smartcaptcha/pricing) · [Restricted mode](https://yandex.cloud/en/docs/smartcaptcha/concepts/restricted-mode)
- **Cloudflare Turnstile** offers a free plan with unlimited challenges and widget limits. Cloudflare has reported throttling of its services by Russian networks. Treat reachability as a deployment check. [Plan](https://developers.cloudflare.com/turnstile/plans/) · [Network report](https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/)

The tariff describes cost. Check actual access before making an external widget required. The example has no live measurements from Russian networks.

1. Load and complete the production form without VPN from a Russian fixed connection and a Russian mobile connection.
2. Verify the token from the product server. Check a valid token, an expired or reused token, an unexpected hostname and an unavailable provider.
3. Confirm the form retains text on failure. Offer a retry or an existing alternate contact channel. Keep message content and tokens out of logs.
