import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Arriving at a page with a record in mind.
 *
 * The dashboard links to `?ref=TSK-014`, and the page it lands on has to do
 * something about it or the link is a page change dressed up as navigation.
 * Two things happen: whatever the page uses to show one record is opened, and
 * the row is scrolled to and lit.
 *
 * The row lookup is by `data-ref` on the element rather than by index, because
 * a page that filters or sorts differently from the list that linked to it
 * would otherwise light the wrong row — which is worse than lighting none.
 */
export function useDeepLink<T>(
  rows: T[],
  match: (row: T, reference: string) => boolean,
  onFound?: (row: T) => void,
) {
  const [params, setParams] = useSearchParams()
  const ref = params.get('ref')

  useEffect(() => {
    if (!ref || rows.length === 0) return
    const row = rows.find((r) => match(r, ref))
    if (row && onFound) onFound(row)

    // After paint, or the row is not in the document yet.
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-ref="${CSS.escape(ref)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
    return () => clearTimeout(t)
    // Deliberately keyed on the reference and the row count only: re-running
    // on every render would fight the user scrolling away from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, rows.length])

  return {
    reference: ref,
    /** Whether a given reference is the one that was linked to. */
    isTarget: (r: string) => Boolean(ref) && r === ref,
    /** Drop the parameter once the reader has moved on. */
    clear: () => { if (ref) { params.delete('ref'); setParams(params, { replace: true }) } },
  }
}
