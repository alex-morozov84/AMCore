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

export interface PasswordChangedEmailProps {
  name: string
  changedAt: string
  loginUrl: string
  supportEmail: string
  locale?: Locale
}

export const PasswordChangedEmail = ({
  name,
  changedAt,
  loginUrl,
  supportEmail,
  locale = 'ru',
}: PasswordChangedEmailProps) => {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })

  // Format date for display
  const formattedDate = new Date(changedAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  })

  return (
    <Html>
      <Head />
      <Preview>{intl.formatMessage({ id: 'passwordChanged.preview' })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{intl.formatMessage({ id: 'passwordChanged.title' })}</Heading>

          <Text style={text}>
            {intl.formatMessage({ id: 'passwordChanged.greeting' }, { name })}
          </Text>

          <Text style={text}>
            {intl.formatMessage({ id: 'passwordChanged.intro' }, { changedAt: formattedDate })}
          </Text>

          <Text style={text}>{intl.formatMessage({ id: 'passwordChanged.sessionsInfo' })}</Text>

          <Section style={buttonContainer}>
            <Button style={button} href={loginUrl}>
              {intl.formatMessage({ id: 'passwordChanged.buttonText' })}
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={warningText}>
            🔐 {intl.formatMessage({ id: 'passwordChanged.securityWarning' }, { supportEmail })}
          </Text>

          <Text style={footer}>{intl.formatMessage({ id: 'passwordChanged.footer' })}</Text>
        </Container>
      </Body>
    </Html>
  )
}

PasswordChangedEmail.PreviewProps = {
  name: 'Александр',
  changedAt: new Date().toISOString(),
  loginUrl: 'https://amcore.alex-morozov.com/login',
  supportEmail: 'support@amcore.com',
  locale: 'ru',
} as PasswordChangedEmailProps

export default PasswordChangedEmail

/**
 * Get subject for Password Changed Email
 * Used by EmailService to get localized subject line
 */
export function getPasswordChangedSubject(locale: Locale = 'ru'): string {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })
  return intl.formatMessage({ id: 'passwordChanged.subject' })
}

// Styles (consistent with other email templates)
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

const warningText = {
  color: '#dc2626',
  fontSize: '14px',
  lineHeight: '1.5',
  padding: '16px 48px',
  margin: '0',
  backgroundColor: '#fef2f2',
  borderLeft: '4px solid #dc2626',
}

const footer = {
  color: '#9ca3af',
  fontSize: '14px',
  lineHeight: '1.5',
  padding: '0 48px',
  marginTop: '32px',
}
