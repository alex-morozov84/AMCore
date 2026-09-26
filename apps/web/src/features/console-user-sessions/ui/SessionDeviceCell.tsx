'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AdminSession } from '@amcore/shared'
import { ChevronDown, Monitor, Smartphone, Tablet } from 'lucide-react'

import { formatSessionLocation, parseSessionDevice } from '@/shared/lib/format-session'

const DEVICE_ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet } as const

/** The parsed, localized device label — shared by the cell below and the row's action menu/confirm copy. */
export function useSessionDeviceLabel(userAgent: string | null) {
  const t = useTranslations('sessions')
  const { browser, os, platformType } = parseSessionDevice(userAgent)
  const label =
    browser && os ? t('deviceLabel', { browser, os }) : (browser ?? os ?? t('deviceUnknown'))
  return { label, platformType }
}

/**
 * Device + approximate-location cell, reused by both the desktop table and
 * the mobile card layout. Raw `userAgent` is never the primary label — it
 * is available only behind an explicit, bounded, escaped disclosure (plain
 * React text content, never `dangerouslySetInnerHTML`) with its own
 * row-specific accessible name.
 */
export function SessionDeviceCell({ session }: { session: AdminSession }) {
  const t = useTranslations('sessions')
  const tCommon = useTranslations('common')
  const tConsole = useTranslations('console')
  const locale = useLocale()
  const [showRaw, setShowRaw] = useState(false)
  const { label, platformType } = useSessionDeviceLabel(session.userAgent)
  const location = formatSessionLocation(session.location, locale)
  const Icon = DEVICE_ICONS[platformType ?? 'desktop']

  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {location ?? t('locationUnavailable')}
        </p>
        <p className="truncate font-console-mono text-xs text-muted-foreground">
          <span className="sr-only">{t('ipAddress')}: </span>
          {session.ipAddress ?? tCommon('notAvailable')}
        </p>
        {session.userAgent && (
          <div>
            <button
              type="button"
              aria-expanded={showRaw}
              aria-label={tConsole('userSessionsShowRawDetailsFor', { device: label })}
              onClick={() => setShowRaw((current) => !current)}
              className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              <span aria-hidden>{tConsole('userSessionsToggleUserAgent')}</span>
              <ChevronDown
                aria-hidden
                className={`size-3 transition-transform ${showRaw ? 'rotate-180' : ''}`}
              />
            </button>
            {showRaw && (
              <p className="mt-1 break-all rounded bg-muted p-2 font-console-mono text-xs">
                <span className="sr-only">{tConsole('userSessionsRawUserAgent')}: </span>
                {session.userAgent}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
