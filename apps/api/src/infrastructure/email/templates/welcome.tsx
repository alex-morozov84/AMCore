import { createIntl } from '@formatjs/intl'
import {
  Body,
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

export interface WelcomeEmailProps {
  name: string
  email: string
  locale?: Locale
}

export const WelcomeEmail = ({ name, email, locale = 'ru' }: WelcomeEmailProps) => {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })

  return (
    <Html>
      <Head />
      <Preview>{intl.formatMessage({ id: 'welcome.preview' })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{intl.formatMessage({ id: 'welcome.title' }, { name })}</Heading>

          <Text style={text}>{intl.formatMessage({ id: 'welcome.intro' })}</Text>

          <Section style={infoBox}>
            <Text style={infoText}>
              <strong>{intl.formatMessage({ id: 'welcome.emailLabel' })}:</strong> {email}
            </Text>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>{intl.formatMessage({ id: 'welcome.footer' })}</Text>
        </Container>
      </Body>
    </Html>
  )
}

WelcomeEmail.PreviewProps = {
  name: 'Александр',
  email: 'alex@example.com',
  locale: 'ru',
} as WelcomeEmailProps

export default WelcomeEmail

/**
 * Get subject for Welcome Email
 * Used by EmailService to get localized subject line
 */
export function getWelcomeSubject(locale: Locale = 'ru'): string {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })
  return intl.formatMessage({ id: 'welcome.subject' })
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

const infoBox = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '16px 24px',
  margin: '32px 48px',
}

const infoText = {
  color: '#374151',
  fontSize: '14px',
  lineHeight: '1.5',
  margin: '0',
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
