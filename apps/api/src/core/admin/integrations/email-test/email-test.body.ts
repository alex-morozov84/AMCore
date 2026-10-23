import {
  preparedEmailBodySchema,
  serializeNotificationEmail,
} from '../../../../infrastructure/email/prepared-email.js'

const SUBJECT = 'AMCore test email / Тестовое письмо AMCore'
const TEXT = [
  'This is a test email from the AMCore Operations Console.',
  'It only checks that the email provider accepted a direct send from the API server.',
  'No action is needed.',
  '',
  'Это тестовое письмо из консоли операций AMCore.',
  'Оно проверяет только, что почтовый провайдер принял прямую отправку с сервера API.',
  'Никаких действий не требуется.',
].join('\n')
const HTML = `<p>${TEXT.split('\n')
  .map((line) => (line ? line : '&nbsp;'))
  .join('<br>')}</p>`

/**
 * The fixed test message: no user content, no link, no secret. The serialiser does not validate,
 * so the body is parsed with the prepared-email schema before it can reach a transport.
 */
export function buildTestEmailBody(from: string, to: string): string {
  const body = serializeNotificationEmail({ from, to, subject: SUBJECT, html: HTML, text: TEXT })
  preparedEmailBodySchema.parse(JSON.parse(body))
  return body
}
