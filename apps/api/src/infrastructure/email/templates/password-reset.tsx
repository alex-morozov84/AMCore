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

export interface PasswordResetEmailProps {
  name: string
  resetUrl: string
  expiresIn: string
  locale?: Locale
}

export const PasswordResetEmail = ({
  name,
  resetUrl,
  expiresIn,
  locale = 'ru',
}: PasswordResetEmailProps) => {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })

  return (
    <Html>
      <Head />
      <Preview>{intl.formatMessage({ id: 'passwordReset.preview' })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{intl.formatMessage({ id: 'passwordReset.title' })}</Heading>

          <Text style={text}>{intl.formatMessage({ id: 'passwordReset.greeting' }, { name })}</Text>

          <Text style={text}>{intl.formatMessage({ id: 'passwordReset.intro' })}</Text>

          <Section style={buttonContainer}>
            <Button style={button} href={resetUrl}>
              {intl.formatMessage({ id: 'passwordReset.buttonText' })}
            </Button>
          </Section>

          <Text style={text}>
            {intl.formatMessage({ id: 'passwordReset.expiresInfo' }, { expiresIn })}
          </Text>

          <Hr style={hr} />

          <Text style={warningText}>
            ⚠️ {intl.formatMessage({ id: 'passwordReset.ignoreInfo' })}
          </Text>

          <Text style={footer}>{intl.formatMessage({ id: 'passwordReset.footer' })}</Text>
        </Container>
      </Body>
    </Html>
  )
}

PasswordResetEmail.PreviewProps = {
  name: 'Александр',
  resetUrl: 'https://amcore.alex-morozov.com/reset-password?token=abc123',
  expiresIn: '1 час',
  locale: 'ru',
} as PasswordResetEmailProps

export default PasswordResetEmail

/**
 * Get subject for Password Reset Email
 * Used by EmailService to get localized subject line
 */
export function getPasswordResetSubject(locale: Locale = 'ru'): string {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })
  return intl.formatMessage({ id: 'passwordReset.subject' })
}

// Styles
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
