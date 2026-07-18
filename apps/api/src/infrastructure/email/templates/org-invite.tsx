import { createIntl } from '@formatjs/intl'

import { emailMessages, type Locale } from '../messages'
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
} from '../react-email'

export interface OrgInviteEmailProps {
  orgName: string
  inviterName: string
  inviterEmail: string
  roleName: string
  hasAccount: boolean
  acceptUrl: string
  expiresIn: string
  locale?: Locale
}

export const OrgInviteEmail = ({
  orgName,
  inviterName,
  inviterEmail,
  roleName,
  hasAccount,
  acceptUrl,
  expiresIn,
  locale = 'ru',
}: OrgInviteEmailProps) => {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })

  // CTA copy is the only branch on `hasAccount`. Both link to the same
  // acceptUrl — the frontend decides sign-in vs sign-up. The recipient
  // already knows their own account state, so this leaks nothing.
  const ctaId = hasAccount ? 'orgInvite.ctaSignIn' : 'orgInvite.ctaSignUp'

  return (
    <Html>
      <Head />
      <Preview>{intl.formatMessage({ id: 'orgInvite.preview' }, { inviterName, orgName })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{intl.formatMessage({ id: 'orgInvite.title' }, { orgName })}</Heading>

          <Text style={text}>
            {intl.formatMessage({ id: 'orgInvite.intro' }, { inviterName, inviterEmail, orgName })}
          </Text>

          <Text style={text}>{intl.formatMessage({ id: 'orgInvite.roleInfo' }, { roleName })}</Text>

          <Section style={buttonContainer}>
            <Button style={button} href={acceptUrl}>
              {intl.formatMessage({ id: ctaId })}
            </Button>
          </Section>

          <Text style={text}>
            {intl.formatMessage({ id: 'orgInvite.expiresInfo' }, { expiresIn })}
          </Text>

          <Hr style={hr} />

          <Text style={footer}>{intl.formatMessage({ id: 'orgInvite.ignoreInfo' })}</Text>
          <Text style={footer}>{intl.formatMessage({ id: 'orgInvite.footer' })}</Text>
        </Container>
      </Body>
    </Html>
  )
}

OrgInviteEmail.PreviewProps = {
  orgName: 'Acme Inc.',
  inviterName: 'Александр',
  inviterEmail: 'alex@example.com',
  roleName: 'MEMBER',
  hasAccount: true,
  acceptUrl: 'https://amcore.alex-morozov.com/invite/accept?token=abc123',
  expiresIn: '7 дней',
  locale: 'ru',
} as OrgInviteEmailProps

export default OrgInviteEmail

/**
 * Get subject for Organization Invite Email.
 * Used by EmailService to get the localized subject line.
 */
export function getOrgInviteSubject(orgName: string, locale: Locale = 'ru'): string {
  const intl = createIntl({
    locale,
    messages: emailMessages[locale],
  })
  return intl.formatMessage({ id: 'orgInvite.subject' }, { orgName })
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

const footer = {
  color: '#9ca3af',
  fontSize: '14px',
  lineHeight: '1.5',
  padding: '0 48px',
  marginTop: '32px',
}
