/**
 * Tenant theming.
 *
 * A tenant sets one colour. Everything else it drives — the readable text on
 * top of it, a tint, a darker hover — is derived here rather than asked for,
 * because a tenant choosing four colours will eventually choose four that do
 * not work together, and the one that fails is the text.
 *
 * Semantic colours are not in this file and cannot be reached from it. Hi-vis
 * means an unallocated gap; green, amber and red mean what they mean. If a
 * tenant could make "overdue" blue, the convention holding every page together
 * is gone.
 */

/** #rgb or #rrggbb → [r, g, b]. Anything else → null, and the caller keeps the default. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

const toHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, '0')).join('').toUpperCase()

/** WCAG relative luminance. */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(
  a: [number, number, number], b: [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE: [number, number, number] = [255, 255, 255]

/**
 * Pure black, not the structural ink (#14181B), and the difference matters.
 *
 * The worst case for this choice is a brand whose contrast against white equals
 * its contrast against black; solving (1.05)/(L+0.05) = (L+0.05)/0.05 puts that
 * at L ≈ 0.179, where both ratios are 4.58 — comfortably past AA. Using a
 * near-black instead drops the dark option enough that a band of mid-luminance
 * brands clears neither: #C25E00 gives 4.29 against white and 4.16 against
 * #14181B, so whichever is picked fails. Against pure black it gives 4.89.
 */
const BLACK: [number, number, number] = [0, 0, 0]

/**
 * The text that goes on the brand colour. Whichever of white and black has more
 * contrast against it wins — so a tenant who picks a pale brand gets dark nav
 * text without being asked, and one who picks navy gets light. By the
 * arithmetic above this never returns worse than 4.58, whatever they pick.
 */
export function inkFor(brand: [number, number, number]): [number, number, number] {
  return contrast(brand, WHITE) >= contrast(brand, BLACK) ? WHITE : BLACK
}

const mix = (
  a: [number, number, number], b: [number, number, number], t: number,
): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export type BrandTokens = {
  brand: string
  brandInk: string
  /** A translucent tint of the brand — rgba, not hex — so it reads as the
   *  brand on obsidian and on paper alike without knowing which is under it. */
  brandSoft: string
  brandDeep: string
  brand2: string
  /** Contrast of the derived ink against the brand. Never below 4.5 by construction. */
  inkContrast: number
}

/** One colour in, the whole brand layer out. */
export function deriveBrand(hex: string): BrandTokens | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const ink = inkFor(rgb)
  return {
    brand: toHex(rgb),
    brandInk: toHex(ink),
    // A tint for grounds, a darker hover and a lighter companion. All keep
    // the hue. The tint is a transparency of the brand rather than a mix with
    // white: mixed with white it was a pale wash that vanished on the dark
    // theme, whereas a 14% brand over whatever ground is there is the same
    // idea on both.
    brandSoft: `rgba(${rgb.map(Math.round).join(', ')}, 0.14)`,
    brandDeep: toHex(mix(rgb, BLACK, 0.35)),
    brand2: toHex(mix(rgb, WHITE, 0.35)),
    inkContrast: Math.round(contrast(rgb, ink) * 100) / 100,
  }
}

/** Push the brand layer into the live stylesheet. Structural and semantic
 *  tokens are never touched: this writes five custom properties and no others. */
export function applyBrand(hex: string): BrandTokens | null {
  const t = deriveBrand(hex)
  if (!t) return null
  const root = document.documentElement.style
  root.setProperty('--brand', t.brand)
  root.setProperty('--brand-ink', t.brandInk)
  root.setProperty('--brand-soft', t.brandSoft)
  root.setProperty('--brand-deep', t.brandDeep)
  root.setProperty('--brand-2', t.brand2)
  return t
}

/** Light or dark. Dark is the stylesheet's default; light is the override, so
 *  the attribute is the whole switch. Structural tokens flip and the semantic
 *  shades follow the ground; the hues and the brand do not move. */
export function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme)
}

/** What the document is showing now. Absent means dark: that is the default. */
export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}
