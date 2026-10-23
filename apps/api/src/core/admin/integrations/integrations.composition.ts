import { EMAIL_TEST_POLICY } from './email-test/email-test.policy.js'
import { EmailTestProbe } from './email-test/email-test.probe.js'
import type { IntegrationRegistration } from './integration.types.js'
import { AiIntegrationModule, AiIntegrationReader } from './readers/ai.reader.js'
import { EmailIntegrationModule, EmailIntegrationReader } from './readers/email.reader.js'
import { OAuthIntegrationModule, OAuthIntegrationReader } from './readers/oauth.reader.js'
import { QueueIntegrationModule, QueueIntegrationReader } from './readers/queue.reader.js'
import { StorageIntegrationModule, StorageIntegrationReader } from './readers/storage.reader.js'
import { TelegramIntegrationModule, TelegramIntegrationReader } from './readers/telegram.reader.js'

/**
 * The one composition root of Console integrations. A module that registers here appears on the
 * Integrations page without any change to the page. Removing an optional module removes its line.
 */
export const INTEGRATIONS: readonly IntegrationRegistration[] = [
  {
    id: 'email',
    name: 'Email',
    module: EmailIntegrationModule,
    reader: EmailIntegrationReader,
    probe: {
      id: 'email_test',
      kind: 'operator_email_test',
      policy: {
        deadlineMs: EMAIL_TEST_POLICY.deadlineMs,
        operatorCooldownSeconds: EMAIL_TEST_POLICY.operatorCooldownSeconds,
        platformPerHour: EMAIL_TEST_POLICY.platformPerHour,
        leaseSeconds: EMAIL_TEST_POLICY.leaseSeconds,
      },
      port: EmailTestProbe,
    },
  },
  {
    id: 'storage',
    name: 'Files',
    module: StorageIntegrationModule,
    reader: StorageIntegrationReader,
  },
  {
    id: 'oauth',
    name: 'Sign-in providers',
    module: OAuthIntegrationModule,
    reader: OAuthIntegrationReader,
  },
  { id: 'queue', name: 'Queue', module: QueueIntegrationModule, reader: QueueIntegrationReader },
  { id: 'ai', name: 'AI', module: AiIntegrationModule, reader: AiIntegrationReader },
  {
    id: 'telegram',
    name: 'Telegram',
    module: TelegramIntegrationModule,
    reader: TelegramIntegrationReader,
  },
]
