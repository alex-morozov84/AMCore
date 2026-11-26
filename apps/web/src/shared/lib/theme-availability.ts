export type ThemeAvailability = 'both' | 'light' | 'dark'

export const THEME_AVAILABILITY: ThemeAvailability = 'both'

export function fixedTheme(availability: ThemeAvailability = THEME_AVAILABILITY) {
  return availability === 'both' ? null : availability
}
