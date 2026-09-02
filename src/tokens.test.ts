/**
 * A Tailwind class naming a design token that was never exposed to Tailwind
 * resolves to nothing at all. There is no error, no warning and no visual clue
 * until someone opens the page: `bg-paper` on a dialog produced a fully
 * transparent panel with illegible buttons, and shipped.
 *
 * `--paper` exists in :root; `--color-paper` does not, so Tailwind never made a
 * `bg-paper` utility. This reads both lists out of index.css and fails the
 * build for any utility built on a token that is defined but not exposed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const CSS = 'src/index.css'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : []
  })
}

/** Utilities that take a colour token. Enough to cover how the app paints. */
const PREFIXES = [
  'bg', 'text', 'border', 'border-l', 'border-r', 'border-t', 'border-b',
  'ring', 'fill', 'stroke', 'from', 'to', 'via', 'decoration', 'outline',
  'divide', 'placeholder', 'shadow', 'accent', 'caret',
]

describe('every design token a class names is exposed to Tailwind', () => {
  test('no utility is built on a token that produces no CSS', () => {
    const css = readFileSync(CSS, 'utf8')

    // Tokens declared as CSS variables, and the subset re-declared under
    // @theme as --color-*, which is what actually creates a utility.
    // Not anchored to the line start: index.css puts two declarations on one
    // line (`--color-ok: ...;  --color-ok-bg: ...;`), and an anchored pattern
    // silently misses the second -- which would make this guard report tokens
    // as unexposed when they are fine.
    const declared = new Set(
      [...css.matchAll(/--([a-z0-9-]+)\s*:/g)]
        .map((m) => m[1])
        .filter((n) => !n.startsWith('color-')))
    const exposed = new Set(
      [...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]))

    // Longest first, so `brand-canvas-ink` is not read as `brand`.
    const candidates = [...declared].sort((a, b) => b.length - a.length)

    const problems: string[] = []
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8')
      for (const prefix of PREFIXES) {
        for (const token of candidates) {
          // A word boundary either side: `bg-ok` must not match `bg-ok-bg`.
          const re = new RegExp(`(?<![\\w-])${prefix}-${token}(?![\\w-])`, 'g')
          if (!re.test(src)) continue
          if (exposed.has(token)) continue
          problems.push(
            `${file}: "${prefix}-${token}" names --${token}, which is defined in ` +
            `${CSS} but never exposed as --color-${token}, so the class produces ` +
            `no CSS at all. Either add --color-${token} to the @theme block, or ` +
            `use a token that is exposed.`)
        }
      }
    }

    expect([...new Set(problems)], [...new Set(problems)].join('\n')).toEqual([])
  })
})
