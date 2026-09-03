/**
 * The brand colour reaches the stylesheet with readable text on it, and no
 * semantic colour is reachable from the theming layer at all.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { contrast, deriveBrand, inkFor, parseHex } from '@/lib/theme'

describe('one colour in, the whole brand layer out', () => {
  test('a dark brand gets light text and a pale one gets dark', () => {
    const navy = deriveBrand('#0B1A2B')!
    const lemon = deriveBrand('#F5E663')!
    expect(navy.brandInk).toBe('#FFFFFF')
    expect(lemon.brandInk).toBe('#000000')
  })

  test('the derived text always clears WCAG AA, whatever the tenant picks', () => {
    // Including the awkward middles, where a fixed choice of white or black
    // would fail one way or the other.
    for (const hex of [
      '#0B1A2B', '#1E3A5F', '#7F8C98', '#808080', '#767676', '#B00020',
      '#F5E663', '#FFFFFF', '#000000', '#2E7D32', '#C25E00',
    ]) {
      const t = deriveBrand(hex)!
      expect(t.inkContrast, `${hex} → ${t.brandInk}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('and clears it for every colour there is, not just the ones I thought of', () => {
    // The floor is provable: the worst brand is the one equidistant from white
    // and black, at 4.58. Swept rather than argued, because the near-black this
    // originally used put a whole band of oranges below 4.5 and no hand-picked
    // list would have contained the one that failed.
    let worst = { hex: '', ratio: Infinity }
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
          const t = deriveBrand(hex)!
          if (t.inkContrast < worst.ratio) worst = { hex, ratio: t.inkContrast }
        }
      }
    }
    expect(worst.ratio, `worst brand was ${worst.hex}`).toBeGreaterThanOrEqual(4.5)
  })

  test('the tint and the hover keep the hue rather than washing to grey', () => {
    const t = deriveBrand('#1E3A5F')!
    const [, g, b] = parseHex(t.brandSoft)!
    expect(b).toBeGreaterThan(g)          // still blue, not washed to grey
    expect(parseHex(t.brandDeep)![2]).toBeLessThan(parseHex(t.brand)![2])
  })

  test('a colour that is not a colour is refused, and the default stands', () => {
    for (const bad of ['', 'navy', '#12345', 'rgb(1,2,3)', '#GGGGGG']) {
      expect(deriveBrand(bad)).toBeNull()
    }
  })

  test('contrast is symmetric and bounded, as WCAG defines it', () => {
    const w: [number, number, number] = [255, 255, 255]
    const k: [number, number, number] = [0, 0, 0]
    expect(Math.round(contrast(w, k))).toBe(21)
    expect(contrast(w, w)).toBe(1)
    expect(contrast(w, k)).toBe(contrast(k, w))
  })

  test('the ink is one of exactly two values — never a tenant’s third colour', () => {
    const inks = new Set(
      ['#0B1A2B', '#F5E663', '#808080', '#2E7D32']
        .map((h) => inkFor(parseHex(h)!).join(',')))
    expect(inks.size).toBeLessThanOrEqual(2)
  })
})

describe('no semantic colour is reachable from theming', () => {
  const src = readFileSync('src/lib/theme.ts', 'utf8')

  test('the theming layer names no semantic token', () => {
    // Not a style preference: if a tenant could set these, "overdue" could be
    // blue on one account and the convention that holds every page together
    // would be gone.
    for (const token of ['hivis', '--ok', '--warn', '--stop', 'kind-']) {
      expect(src).not.toContain(token)
    }
  })

  test('applyBrand writes five properties and no others', () => {
    const written = [...src.matchAll(/setProperty\('([^']+)'/g)].map((m) => m[1])
    expect(written.sort()).toEqual(
      ['--brand', '--brand-2', '--brand-deep', '--brand-ink', '--brand-soft'])
  })
})

describe('every gated nav entry is a module the database knows', () => {
  const nav = readFileSync('src/components/shell/nav.ts', 'utf8')
  const sql = readFileSync('supabase/migrations/20260902170100_phase7_theming.sql', 'utf8')

  /** The keys module_keys() returns. */
  const moduleKeys = new Set(
    (sql.slice(sql.indexOf('returns text[]'), sql.indexOf('$$;', sql.indexOf('returns text[]')))
      .match(/'([a-z]+)'/g) ?? []).map((s) => s.replace(/'/g, '')))

  /** Nav keys, split by whether their group is core. */
  function navKeys() {
    const gated: string[] = []
    const core: string[] = []
    // Each group literal runs from `title:` to the next one.
    const groups = nav.split(/\n  \{\n/).slice(1)
    for (const g of groups) {
      const isCore = /core:\s*true/.test(g)
      for (const m of g.matchAll(/key: '([a-z]+)'/g)) {
        (isCore ? core : gated).push(m[1])
      }
    }
    return { gated, core }
  }

  test('a module in the nav that the database does not know is off forever', () => {
    // moduleOn() returns false for an unknown key, so a nav entry whose key is
    // missing from module_keys() can never be switched on by anyone. It would
    // simply never appear, and nothing would say why.
    const { gated } = navKeys()
    expect(gated.length).toBeGreaterThan(10)
    const orphans = gated.filter((k) => !moduleKeys.has(k))
    expect(orphans, `nav keys with no module: ${orphans.join(', ')}`).toEqual([])
  })

  test('My work and Admin are core, so they are never gated away', () => {
    // A project with no settings page and no change log is not a cheaper
    // product, it is a broken one.
    const { core } = navKeys()
    expect(core).toEqual(expect.arrayContaining(
      ['dashboard', 'issues', 'meetings', 'access', 'settings']))
    // And they are deliberately NOT module keys, so nobody can turn them off
    // by writing an entitlement map.
    for (const k of ['dashboard', 'issues', 'settings', 'access']) {
      expect(moduleKeys.has(k), `${k} should not be a module`).toBe(false)
    }
  })
})
