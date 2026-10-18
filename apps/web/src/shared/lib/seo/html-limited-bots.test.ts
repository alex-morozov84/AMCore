import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots'
import { describe, expect, it } from 'vitest'

import { HTML_LIMITED_BOTS } from './html-limited-bots'

describe('HTML_LIMITED_BOTS', () => {
  it("equals Next's default list plus Googlebot, so a change in Next's list fails here", () => {
    expect(HTML_LIMITED_BOTS.source).toBe(`${HTML_LIMITED_BOT_UA_RE.source}|Googlebot`)
    expect(HTML_LIMITED_BOTS.flags).toBe(HTML_LIMITED_BOT_UA_RE.flags)
  })

  it.each([
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/126 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Googlebot-Image/1.0',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Twitterbot/1.0',
    'Mediapartners-Google',
  ])('gives head metadata to %s', (userAgent) => {
    expect(HTML_LIMITED_BOTS.test(userAgent)).toBe(true)
  })

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    'curl/8.4.0',
  ])('keeps streaming metadata for the ordinary client %s', (userAgent) => {
    expect(HTML_LIMITED_BOTS.test(userAgent)).toBe(false)
  })
})
