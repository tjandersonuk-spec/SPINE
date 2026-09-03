/**
 * The public site says only true things, and stays public.
 *
 * A marketing page is the easiest place in a codebase for a claim to go stale:
 * nothing breaks when the pricing table promises a module that was renamed or
 * never built, no test fails, and nobody finds out until a customer asks for
 * it. These are the three ways that happens, held shut.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { PRICING, TIERS } from '@/pages/marketing/tiers'

const app = readFileSync('src/App.tsx', 'utf8')
const layout = readFileSync('src/pages/marketing/Layout.tsx', 'utf8')

/** The catalogue is the one registry of what a module is. Read from the
 *  migration, the same way the nav guard reads it. */
const sql = readFileSync(
  'supabase/migrations/20260902250000_entitlements_owner_only.sql', 'utf8')
const MODULES = new Set(
  (sql.slice(sql.indexOf('function module_catalogue'),
             sql.indexOf('$$;', sql.indexOf('function module_catalogue')))
    .match(/\(\s*'([a-z]+)',/g) ?? []).map((s) => s.replace(/[(\s',]/g, '')))

describe('the site cannot promise a module that does not exist', () => {
  test('every key on the product page is a real module, or the core', () => {
    expect(MODULES.size).toBeGreaterThan(20)
    const named = TIERS.flatMap((t) => t.items.map((i) => i.key))
    const unknown = [...new Set(named)].filter((k) => k !== 'core' && !MODULES.has(k))
    expect(unknown, `the site names modules the database does not know: ${unknown.join(', ')}`)
      .toEqual([])
  })

  test('every module the product page names is one somebody could actually be sold', () => {
    // The opposite direction is deliberately not asserted: the site is allowed
    // to describe fewer modules than exist, because a page listing all
    // twenty-six would be a database schema rather than a pitch. What is not
    // allowed is naming one that cannot be bought.
    const gated = TIERS.flatMap((t) => t.items.map((i) => i.key)).filter((k) => k !== 'core')
    expect(gated.length).toBeGreaterThan(10)
  })
})

describe('the public site is reachable without a login', () => {
  const PUBLIC = ['/product', '/pricing', '/about', '/contact']

  test('every marketing route exists', () => {
    const routes = new Set(
      [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]))
    for (const p of PUBLIC) expect(routes.has(p), `no route for ${p}`).toBe(true)
  })

  test('no marketing route sits behind RequireAuth', () => {
    // A public page that redirects to sign-in is not a public page. The
    // marketing routes are nested under MarketingLayout, which is not wrapped;
    // this reads the block they are in and fails if a guard appears around it.
    const block = app.slice(
      app.indexOf('<Route element={<MarketingLayout />}>'),
      app.indexOf('</Route>', app.indexOf('<Route element={<MarketingLayout />}>')))
    expect(block).not.toContain('RequireAuth')
    for (const p of PUBLIC) expect(block).toContain(`path="${p}"`)
  })

  test('every link in the public header points at a page that exists', () => {
    const routes = new Set(
      [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]))
    routes.add('/')                                    // the Root decider
    const targets = [...layout.matchAll(/to: '([^']+)'|to="([^"]+)"/g)]
      .map((m) => m[1] ?? m[2])
    const missing = targets.filter((t) => !routes.has(t))
    expect(missing, `public nav points at nothing: ${missing.join(', ')}`).toEqual([])
  })

  test('`/` decides between the site and the application', () => {
    // Both live at the same address on purpose: the marketing page has to be
    // the thing at the top of the domain, and a signed-in person must never be
    // shown a sales page for a product they have already bought.
    const root = app.slice(app.indexOf('function Root()'), app.indexOf('function Root()') + 700)
    expect(root).toContain('MarketingHome')
    expect(root).toContain('WorkspaceLayout')
    expect(root).toContain('if (!session)')
  })
})

describe('pricing states a structure, not an invented number', () => {
  test('no figure is quoted', () => {
    // The brief says "a placeholder structure, figures to be set". A
    // placeholder number on a public page is a number somebody quotes back at
    // you in a negotiation, so there is none to find.
    const page = readFileSync('src/pages/marketing/Pricing.tsx', 'utf8')
    const money = page.match(/[£$€]\s?[\d,]+/g) ?? []
    expect(money, `pricing quotes a figure: ${money.join(', ')}`).toEqual([])
    for (const p of PRICING) expect(p.per).toMatch(/per account/)
  })

  test('the working name is still labelled as one', () => {
    // "Spine" is a placeholder to be replaced. If that stops being said out
    // loud it stops being a placeholder and becomes the name by default.
    expect(layout).toMatch(/working name/i)
  })
})
