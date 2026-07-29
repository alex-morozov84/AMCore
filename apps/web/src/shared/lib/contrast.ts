/** WCAG 2.x relative luminance + contrast ratio, sRGB hex input only. */

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const value = parseInt(normalized, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const normalized = c / 255
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
  }
  const [red, green, blue] = [channel(r), channel(g), channel(b)]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** Returns a ratio in [1, 21]. 21 = black on white (max contrast). */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexToRgb(hexA))
  const luminanceB = relativeLuminance(hexToRgb(hexB))
  const [lighter, darker] =
    luminanceA > luminanceB ? [luminanceA, luminanceB] : [luminanceB, luminanceA]
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG 2.x AA thresholds. */
export const WCAG_AA_NORMAL_TEXT = 4.5
export const WCAG_AA_LARGE_TEXT = 3
