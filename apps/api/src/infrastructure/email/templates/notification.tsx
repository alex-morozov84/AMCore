import { createIntl } from '@formatjs/intl'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

import { emailMessages, type Locale } from '../messages'

export interface NotificationEmailProps {
  /** Already localized + content-policy-applied by the dispatcher. */
  title: string
  body: string
  /** Trusted app base URL (FRONTEND_URL); when present, renders the CTA button. */
  actionUrl?: string
  locale?: Locale
}

/**
 * Generic notification email (ADR-052). One template for every notification type — the
 * dispatcher supplies the localized `title`/`body` (detailed per the definition, or a
 * neutral summary for SENSITIVE/PERSONAL content), so this component never sees a raw
 * payload. The CTA always points at the trusted app base, never an arbitrary URL.
 */
export const NotificationEmail = ({
  title,
  body,
  actionUrl,
  locale = 'ru',
}: NotificationEmailProps) => {
  const intl = createIntl({ locale, messages: emailMessages[locale] })

  return (
    <Html>
      <Head />
      <Preview>{intl.formatMessage({ id: 'notification.preview' })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{title}</Heading>

          <Text style={text}>{body}</Text>

          {actionUrl ? (
            <Section style={buttonContainer}>
              <Button style={button} href={actionUrl}>
                {intl.formatMessage({ id: 'notification.openButton' })}
              </Button>
            </Section>
          ) : null}

          <Hr style={hr} />

          <Text style={footer}>{intl.formatMessage({ id: 'notification.footer' })}</Text>
        </Container>
      </Body>
    </Html>
  )
}

NotificationEmail.PreviewProps = {
  title: 'Профиль обновлён',
  body: 'Вы изменили данные профиля.',
  actionUrl: 'https://amcore.alex-morozov.com',
  locale: 'ru',
} as NotificationEmailProps

export default NotificationEmail

// Styles (consistent with the other email templates).
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
}

const h1 = {
  color: '#1a1a1a',
  fontSize: '28px',
  fontWeight: '700',
  margin: '40px 0',
  padding: '0 48px',
  lineHeight: '1.3',
}

const text = {
  color: '#484848',
  fontSize: '16px',
  lineHeight: '1.6',
  padding: '0 48px',
  margin: '16px 0',
}

const buttonContainer = {
  padding: '32px 48px',
}

const button = {
  backgroundColor: '#8b5cf6',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '14px 24px',
}

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 48px',
}

const footer = {
  color: '#9ca3af',
  fontSize: '14px',
  lineHeight: '1.5',
  padding: '0 48px',
  marginTop: '32px',
}
