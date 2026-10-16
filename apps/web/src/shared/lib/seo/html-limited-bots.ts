/**
 * User agents that get metadata in `<head>` instead of streamed into `<body>` (`next.config.ts`
 * `htmlLimitedBots`). Next's default list plus `Googlebot`.
 *
 * Why: for a dynamically rendered page Next streams `generateMetadata` output into the page body
 * once it resolves, and sends `<head>` metadata only to bots on this list. Plain `Googlebot` is not
 * on it, and Google accepts `rel=canonical` and hreflang only from `<head>`. Whether the tags
 * land in `<head>` depends on how fast the metadata resolves: a page whose `generateMetadata`
 * reads a database may put them in `<body>` (measured: a 1 s `generateMetadata` did). Listing
 * Googlebot makes Google's crawler wait for the metadata and get it in `<head>`; browsers keep
 * streaming. Setting this option REPLACES Next's list, hence the full copy.
 *
 * `html-limited-bots.test.ts` requires the source to equal Next's default plus `|Googlebot`, so
 * any change Next makes to its list fails there and is reviewed on purpose.
 */
export const HTML_LIMITED_BOTS =
  /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|Googlebot/i
