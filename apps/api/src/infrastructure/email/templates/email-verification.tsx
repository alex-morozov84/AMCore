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

export interface EmailVerificationProps {
  name: string
  verificationUrl: string
  expiresIn: string
  locale?: Locale
}

export const EmailVerificationEmail = ({
  name,
  verificationUrl,
  expiresIn,
  locale = 'ru',
}: EmailVerificationProps) => {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })

  return (
    <Html>
      <Head />
      <Preview>{intl.formatMessage({ id: 'emailVerification.preview' })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{intl.formatMessage({ id: 'emailVerification.title' })}</Heading>

          <Text style={text}>
            {intl.formatMessage({ id: 'emailVerification.greeting' }, { name })}
          </Text>

          <Text style={text}>{intl.formatMessage({ id: 'emailVerification.intro' })}</Text>

          <Section style={buttonContainer}>
            <Button style={button} href={verificationUrl}>
              {intl.formatMessage({ id: 'emailVerification.buttonText' })}
            </Button>
          </Section>

          <Text style={text}>
            {intl.formatMessage({ id: 'emailVerification.expiresInfo' }, { expiresIn })}
          </Text>

          <Hr style={hr} />

          <Text style={footer}>{intl.formatMessage({ id: 'emailVerification.footer' })}</Text>
        </Container>
      </Body>
    </Html>
  )
}

EmailVerificationEmail.PreviewProps = {
  name: 'Александр',
  verificationUrl: 'https://amcore.alex-morozov.com/verify-email?token=xyz789',
  expiresIn: '24 часа',
  locale: 'ru',
} as EmailVerificationProps

export default EmailVerificationEmail

/**
 * Get subject for Email Verification Email
 * Used by EmailService to get localized subject line
 */
export function getEmailVerificationSubject(locale: Locale = 'ru'): string {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })
  return intl.formatMessage({ id: 'emailVerification.subject' })
}

// Styles (same as password-reset for consistency)
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
