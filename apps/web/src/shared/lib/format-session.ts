import type { SessionLocation } from '@amcore/shared'
import Bowser from 'bowser'

export interface ParsedSessionDevice {
  browser: string | null
  os: string | null
  /** Bowser's own platform classification — used only to pick a device icon; never displayed as text. */
  platformType: 'desktop' | 'mobile' | 'tablet' | null
}

/**
 * Parses a session's raw `userAgent` into a browser/OS pair for display —
 * never the raw string itself as the primary label. Universal (no
 * `navigator`/`window`, no `client-only`/`server-only` marker): the raw
 * `userAgent` column is plain data on both the Console admin session list
 * and Settings' own session list, so this runs on either side. Returns
 * `null`/`null` for a missing or fully-unparseable user agent; the caller
 * localizes the final "Browser on OS" / unknown-device label — this stays
 * framework-agnostic and does not itself depend on next-intl.
 */
const KNOWN_PLATFORM_TYPES = new Set(['desktop', 'mobile', 'tablet'])

export function parseSessionDevice(userAgent: string | null): ParsedSessionDevice {
  if (!userAgent) return { browser: null, os: null, platformType: null }
  const parsed = Bowser.parse(userAgent)
  // Bowser returns an empty string, not undefined, for an unrecognized
  // user agent's browser/OS name — normalize both "absent" shapes to null.
  const platformType = KNOWN_PLATFORM_TYPES.has(parsed.platform.type ?? '')
    ? (parsed.platform.type as 'desktop' | 'mobile' | 'tablet')
    : null
  return { browser: parsed.browser.name || null, os: parsed.os.name || null, platformType }
}

/**
 * Composes an already-resolved `SessionLocation` into a single display
 * string ("Berlin, Germany"), or `null` when there is nothing to show
 * (caller renders its own localized "location unavailable" fallback).
 * `city` was already resolved server-side in the caller's negotiated
 * locale (GeoIP city names are only ever available in the languages the
 * database itself ships); `countryCode` is a narrow ISO 3166-1 alpha-2
 * code localized here on the client via the platform `Intl.DisplayNames`
 * region formatter, never a second GeoIP-driven translation path.
 */
export function formatSessionLocation(
  location: SessionLocation | null,
  locale: string
): string | null {
  if (!location) return null
  const countryName = location.countryCode ? countryDisplayName(location.countryCode, locale) : null
  if (location.city && countryName) return `${location.city}, ${countryName}`
  return location.city ?? countryName ?? null
}

function countryDisplayName(countryCode: string, locale: string): string | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryCode) ?? null
  } catch {
    return null
  }
}
